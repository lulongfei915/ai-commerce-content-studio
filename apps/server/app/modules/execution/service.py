from typing import Any, Literal

from fastapi import HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.modules.assets.models import PrivateFile
from app.modules.commerce.models import ModelCall
from app.modules.creation.capabilities import validate_parameters
from app.modules.creation.models import Creation, CreationOutput
from app.modules.creation.results import asset_id_for
from app.modules.creation.schemas import InputSnapshot, VideoParameters
from app.modules.creation.service import REFERENCE_TAG, build_input_snapshot, get_creation
from app.modules.delivery.service import LABELS, has_reservation, module_for
from app.modules.identity.models import Tenant, User, new_id
from app.modules.identity.team import add_record
from app.modules.products.schemas import ResourceId
from app.modules.products.service import get_fact, get_product
from app.modules.tasks.models import DeliveryPosition
from app.modules.tasks.service import get_task
from app.modules.templates.schemas import VersionInput
from app.shared.config import Settings
from app.shared.entitlements import require_paid_calls
from app.shared.studio_errors import check_version

from .models import Execution, ImageStep
from .sources import verify_sources


class Submission(VersionInput):
    idempotency_key: str = Field(min_length=1, max_length=100)
    position_id: ResourceId | None = None


class OutputState(BaseModel):
    id: str
    status: str
    fee_state: str
    error: str | None
    provider_id: str | None
    reserved_cents: int
    actual_cents: int | None
    result_size: str | None = None


class ExecutionState(BaseModel):
    id: str
    media: Literal["image", "video"] = "image"
    outputs: list[OutputState]


def state(db: Session, job: Execution) -> ExecutionState:
    rows = db.execute(
        select(CreationOutput, ImageStep)
        .join(ImageStep, ImageStep.output_id == CreationOutput.id)
        .where(ImageStep.execution_id == job.id)
        .order_by(CreationOutput.output_index)
    )
    return ExecutionState(
        id=job.id,
        media="video" if job.snapshot.get("media") == "video" else "image",
        outputs=[
            OutputState(
                id=o.id,
                status=o.status,
                fee_state=s.fee_state,
                error=s.error,
                provider_id=s.provider_id,
                reserved_cents=s.reserved_cents,
                actual_cents=s.actual_cents,
                result_size=s.result_size,
            )
            for o, s in rows
        ],
    )


def lock_budget(db: Session, tenant: str) -> None:
    db.execute(select(Tenant.id).where(Tenant.id == tenant).with_for_update())


def require_budget(
    db: Session, tenant: str, settings: Settings, amount: int, *,
    for_image: bool = False, for_video: bool = False,
) -> None:
    require_paid_calls(settings)
    if for_video and settings.video_budget_unlimited:
        return
    budget = settings.video_budget_cents if for_video else settings.image_budget_cents
    missing = "video_budget_not_configured" if for_video else "budget_not_configured"
    if amount <= 0:
        raise HTTPException(402, missing)
    if for_image and settings.image_budget_unlimited:
        return
    if budget <= 0:
        raise HTTPException(402, missing)
    media = func.coalesce(Execution.snapshot["media"].as_string(), "image")
    rows = db.scalars(
        select(ImageStep).join(Execution).where(
            Execution.tenant_id == tenant, media == ("video" if for_video else "image"),
        ).with_for_update()
    )
    committed = sum(
        s.actual_cents if s.actual_cents is not None else s.reserved_cents for s in rows
    )
    if not for_video:
        committed += sum(
            db.scalars(
                select(ModelCall.reserved_cents).where(ModelCall.tenant_id == tenant)
                .with_for_update()
            )
        )
    if committed + amount > budget:
        raise HTTPException(402, "video_budget_unavailable" if for_video else "budget_unavailable")


def image_ceiling(settings: Settings, provider: str) -> int:
    if provider == "gpt-image" and settings.itaiapi_image_ceiling_cents is not None:
        return settings.itaiapi_image_ceiling_cents
    return settings.image_ceiling_cents


def require_video_provider(settings: Settings) -> None:
    if not settings.ark_api_key or not settings.ark_api_key.get_secret_value().strip():
        raise HTTPException(503, "video_provider_not_configured")


def position_version(position: DeliveryPosition) -> list[str | int | None]:
    return [module_for(position), position.ratio, position.resolution, position.duration]


def video_snapshot(
    db: Session, source: InputSnapshot, settings: Settings, facts: dict[str, Any],
) -> dict[str, Any]:
    require_video_provider(settings)
    params = source.draft.video_parameters or VideoParameters()
    version_25 = params.model == "seedance-2.5"
    model = settings.ark_video_25_model if version_25 else settings.ark_video_model
    if not model:
        raise HTTPException(422, "video_model_unavailable")
    if not version_25 and params.duration > 15:
        raise HTTPException(422, "video_duration_unsupported")
    if params.resolution in {"1080p", "4k"} and any(
        f"-{tier}-" in model.lower() for tier in ("fast", "mini", "flash")
    ):
        raise HTTPException(422, "resolution_unsupported")
    frames = [ref for ref in source.references if ref.usage in {"first_frame", "last_frame"}]
    if frames and (
        len(frames) != len(source.references) or {ref.usage for ref in frames} == {"last_frame"}
    ):
        raise HTTPException(422, "video_frame_combination_unsupported")
    videos = [ref for ref in source.references if ref.media == "video"]
    if len(videos) > (5 if "flash" in model else 10 if version_25 else 3) or sum(
        ref.media == "image" for ref in source.references
    ) > (10 if "flash" in model else 30 if version_25 else 9):
        raise HTTPException(422, "video_reference_limit")
    if videos and not (settings.storage_signed_endpoint or "").startswith("https://"):
        raise HTTPException(503, "video_reference_storage_not_configured")
    durations = []
    frame_size = None
    image_bytes = 0
    for index, ref in enumerate(source.references):
        file = db.get(PrivateFile, ref.file_id)
        assert file is not None
        if ref.media == "video":
            seconds = file.duration_seconds or 0
            if not 2 <= seconds <= (30 if version_25 else 15):
                raise HTTPException(422, {
                    "code": "video_reference_duration", "field": f"references.{index}",
                })
            durations.append(seconds)
        else:
            image_bytes += file.size_bytes
            if ref.usage == "first_frame" and file.width and file.height:
                frame_size = [file.width, file.height]
        if not file.width or not file.height or not (
            300 <= min(file.width, file.height)
            and max(file.width, file.height) <= 6000
            and 0.4 <= file.width / file.height <= 2.5
        ):
            raise HTTPException(422, {
                "code": "video_reference_dimensions", "field": f"references.{index}",
            })
    if sum(durations) > (30 if version_25 else 15):
        raise HTTPException(422, "video_reference_duration")
    if image_bytes > 45 * 1024 * 1024 and not (
        settings.storage_signed_endpoint or ""
    ).startswith("https://"):
        raise HTTPException(422, "video_reference_limit")
    if version_25 and frames and params.ratio != "adaptive":
        raise HTTPException(422, "video_frame_ratio_required")
    if params.ratio == "adaptive" and not (version_25 and frames):
        raise HTTPException(422, "video_frame_ratio_required")
    ordered = sorted(frames, key=lambda ref: ref.usage) if frames else source.references
    labels = {}
    for media, label in (("image", "图片"), ("video", "视频")):
        labels.update({
            ref.id: f"{'@' if version_25 else ''}{label}{index}"
            for index, ref in enumerate((ref for ref in ordered if ref.media == media), 1)
        })
    storyboard = source.draft.storyboard
    prompt = source.draft.prompt
    if storyboard:
        start = 0
        lines = []
        for shot in storyboard.shots:
            end = start + shot.duration
            line = f"{start}-{end} 秒：{shot.visual}"
            if shot.narration:
                line += f"；文案或旁白：{shot.narration}"
            if shot.fact_keys:
                line += "；已确认商品事实：" + "、".join(
                    str(facts[key]["value"]) for key in shot.fact_keys
                )
            lines.append(line)
            start = end
        prompt += "\n\n成片分镜：\n" + "\n".join(lines)
    if set(REFERENCE_TAG.findall(prompt)) - labels.keys():
        raise HTTPException(422, "reference_label_dangling")
    return {
        **source.model_dump(exclude={"references"}),
        "references": [ref.model_dump() for ref in ordered],
        "media": "video",
        "provider": "ark",
        "model": model,
        "frame_size": frame_size,
        "storyboard": storyboard.model_dump() if storyboard else None,
        "facts": facts,
        "video_request": {
            **params.model_dump(exclude={"model", "count"}),
            "seedance_25": version_25,
            "resolution": ("4K" if not version_25 else "4k")
            if params.resolution == "4k" else params.resolution,
            "prompt": REFERENCE_TAG.sub(lambda match: labels[match[1]], prompt),
        },
    }


def submit(
    db: Session,
    tenant: str,
    user: str,
    identifier: str,
    data: Submission,
    settings: Settings,
    parent: CreationOutput | None = None,
    *,
    batch: bool = False,
) -> ExecutionState:
    lock_budget(db, tenant)
    scope = get_creation(db, tenant, identifier)
    get_task(db, tenant, scope.task_id, lock=True)
    draft = get_creation(db, tenant, identifier, lock=True)
    prior = db.scalar(
        select(Execution)
        .where(Execution.tenant_id == tenant, Execution.request_key == data.idempotency_key)
        .with_for_update()
    )
    if prior:
        if (
            prior.creation_id != identifier
            or prior.snapshot["draft"]["version"] != data.expected_version
            or prior.parent_output != (parent.id if parent else None)
            or prior.snapshot.get("requested_position") != data.position_id
        ):
            raise HTTPException(409, "idempotency_conflict")
        return state(db, prior)
    check_version(draft.version, data.expected_version)
    is_video = draft.purpose == "video"
    old_position = None
    if draft.entry == "batch" and not (batch or parent):
        raise HTTPException(422, "image_entry_required")
    video_params = VideoParameters.model_validate(draft.video_parameters or {})
    count = 1 if parent else video_params.count if is_video else int(draft.parameters["count"])
    if is_video and not parent and draft.storyboard and (
        draft.storyboard["confirmed_version"] != draft.version
    ):
        raise HTTPException(409, "video_delivery_confirmation_required")
    if is_video and db.scalar(
        select(CreationOutput.id)
        .join(Execution, Execution.id == CreationOutput.execution_id)
        .where(
            Execution.creation_id == draft.id,
            CreationOutput.status.in_(("queued", "generating", "saving")),
        )
        .limit(1).with_for_update()
    ):
        raise HTTPException(409, "video_execution_in_progress")
    if parent:
        old = db.get(Execution, parent.execution_id)
        step = db.get(ImageStep, parent.id)
        if not old or not step or parent.status != "rejected":
            raise HTTPException(409, "rework_unavailable")
        old_position = old.position_id
        snapshot = {**old.snapshot, "feedback": step.decision}
        snapshot["draft"] = {**snapshot["draft"], "version": data.expected_version}
        if is_video and step.decision:
            request = snapshot["video_request"]
            feedback = [step.decision.get("reason", "")] + [
                f"{note['start']}-{note['end']} 秒：{note['note']}"
                for note in step.decision.get("time_notes", [])
            ]
            prompt = "\n".join(filter(None, feedback))
            if prompt:
                snapshot["video_request"] = {
                    **request, "prompt": f"{request['prompt']}\n\n整条视频返工意见：\n{prompt}",
                }
    elif is_video:
        source = build_input_snapshot(db, draft, settings=settings)
        if source.draft.storyboard and (
            source.draft.storyboard.product_fact_version != source.product_fact_version
        ):
            raise HTTPException(409, "video_delivery_confirmation_required")
        product = get_product(db, tenant, draft.product_id)
        facts = get_fact(db, product, source.product_fact_version).facts
        snapshot = video_snapshot(db, source, settings, facts)
    else:
        source = build_input_snapshot(db, draft, settings=settings)
        params = source.draft.parameters
        size = validate_parameters(params, settings=settings)
        product = get_product(db, tenant, draft.product_id)
        snapshot = {
            **source.model_dump(),
            "facts": get_fact(db, product, source.product_fact_version).facts,
            "category": product.category,
            "provider": params.provider,
            "model": params.model if params.provider == "gpt-image" else settings.ark_image_model,
            "size": f"{size['width']}x{size['height']}",
            "quality": (params.quality or "low") if params.provider == "gpt-image" else None,
        }
    verify_sources(db, tenant, snapshot)
    position = None
    if is_video:
        require_video_provider(settings)
        storyboard = snapshot.get("storyboard")
        if data.position_id and (
            not storyboard or data.position_id != storyboard["position_id"]
        ):
            raise HTTPException(422, "video_delivery_confirmation_required")
        if storyboard:
            position = position_for(db, draft, storyboard["position_id"])
            if not position or position_version(position) != storyboard["position_version"]:
                raise HTTPException(409, "video_delivery_confirmation_required")
            request = snapshot["video_request"]
            ratio = request["ratio"]
            if ratio == "adaptive" and position.ratio and snapshot.get("frame_size"):
                w, h = snapshot["frame_size"]
                a, b = map(int, position.ratio.split(":"))
                if abs(w / h / (a / b) - 1) < 0.01:
                    ratio = position.ratio
            if position.ratio and (
                (ratio, request["resolution"].lower(), request["duration"])
                != (position.ratio, position.resolution, position.duration)
            ):
                raise HTTPException(422, "delivery_spec_mismatch")
            if not parent and (has_reservation(db, position.id) or position.status == "adopted"):
                raise HTTPException(409, "position_already_reserved")
            snapshot["delivery_module"] = module_for(position)
        snapshot["requested_position"] = data.position_id
    if not is_video:
        position = position_for(db, draft, data.position_id or old_position)
        if not position and not parent:
            raise HTTPException(409, "position_unavailable")
        if position and not parent:
            if position.ratio and (
                (params.ratio, params.resolution) != (position.ratio, position.resolution)
            ):
                raise HTTPException(422, "delivery_spec_mismatch")
            if data.position_id and (
                has_reservation(db, position.id) or position.status == "adopted"
            ):
                raise HTTPException(409, "position_already_reserved")
            snapshot["delivery_module"] = module_for(position)
        snapshot["requested_position"] = data.position_id
    ceiling = (
        settings.video_ceiling_cents if is_video
        else image_ceiling(settings, snapshot.get("provider", "ark"))
    )
    require_budget(
        db, tenant, settings, count * ceiling, for_image=not is_video, for_video=is_video,
    )
    job = Execution(
        id=new_id(),
        tenant_id=tenant,
        creation_id=draft.id,
        user_id=user,
        request_key=data.idempotency_key,
        snapshot=snapshot,
        parent_output=parent.id if parent else None,
        position_id=position.id if position else None,
    )
    db.add(job)
    db.flush()
    for index in range(count):
        output = CreationOutput(
            id=new_id(),
            creation_id=draft.id,
            execution_id=job.id,
            output_index=parent.output_index if parent else index,
            asset_id=asset_id_for(parent) if parent else new_id(),
            version=(
                max(
                    parent.version,
                    db.scalar(
                        select(func.max(CreationOutput.version)).where(
                            CreationOutput.asset_id == asset_id_for(parent)
                        )
                    )
                    or 0,
                )
                + 1
                if parent
                else 1
            ),
            status="queued",
        )
        db.add(output)
        db.flush()
        db.add(
            ImageStep(
                output_id=output.id,
                execution_id=job.id,
                reserved_cents=ceiling,
            )
        )
    if position and position.status == "unfilled":
        position.status = "reserved"
    actor = db.get_one(User, user)
    medium = "视频" if is_video else "图片"
    action = f"提交{medium}{'返工' if parent else '生成'}"
    add_record(db, tenant, actor.email, action, f"{job.id} · {count}")
    if batch:
        db.flush()
    else:
        db.commit()
    return state(db, job)


def position_for(
    db: Session, draft: Creation, identifier: str | None = None
) -> DeliveryPosition | None:
    query = select(DeliveryPosition).where(
        DeliveryPosition.tenant_id == draft.tenant_id,
        DeliveryPosition.task_id == draft.task_id,
        DeliveryPosition.product_id == draft.product_id,
        DeliveryPosition.purpose == draft.purpose,
    )
    if identifier:
        query = query.where(DeliveryPosition.id == identifier)
    positions = list(db.scalars(query.order_by(DeliveryPosition.id).with_for_update()))
    if identifier:
        return positions[0] if positions else None
    return next(
        (p for p in positions if module_for(p) == LABELS[draft.purpose]),
        positions[0] if len(positions) == 1 else None,
    )
