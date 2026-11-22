from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.cases.service import licensed_case_file
from app.modules.creation.capabilities import validate_parameters
from app.shared.studio_errors import reject

from .models import Template, TemplateVersion
from .schemas import TemplateContent, TemplateView


def find_template(db: Session, tenant: str, identifier: str, *, lock: bool = False) -> Template:
    query = select(Template).where(Template.tenant_id == tenant, Template.id == identifier)
    item = db.scalar(query.with_for_update() if lock else query)
    if item is None:
        raise HTTPException(404, "template_not_found")
    return item


def version_content(db: Session, item: Template, number: int) -> TemplateContent:
    version = db.get(TemplateVersion, (item.id, number))
    if version is None:
        raise HTTPException(404, "template_version_not_found")
    return TemplateContent.model_validate(version.content)


def view(item: Template, content: TemplateContent | None = None) -> TemplateView:
    return TemplateView(
        id=item.id,
        version=item.version,
        enabled=item.enabled,
        published_version=item.published_version,
        content=content or TemplateContent.model_validate(item.draft),
    )


def publish(db: Session, item: Template) -> TemplateView:
    draft = TemplateContent.model_validate(item.draft)
    if not draft.prompt:
        reject("prompt", "prompt_required")
    if len(set(draft.case_ids)) != len(draft.case_ids):
        reject("case_ids", "reference_duplicate")
    validate_parameters(draft.parameters, len(draft.case_ids))
    for index, case_id in enumerate(draft.case_ids):
        licensed_case_file(
            db, item.tenant_id, case_id, draft.category, draft.purpose, f"case_ids.{index}"
        )
    number = (item.published_version or 0) + 1
    db.add(TemplateVersion(template_id=item.id, number=number, content=draft.model_dump()))
    item.published_version = number
    item.version += 1
    db.commit()
    return view(item)
