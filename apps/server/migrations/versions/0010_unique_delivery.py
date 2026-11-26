"""Fill existing empty delivery positions with a single valid approved version."""

from alembic import op
from sqlalchemy import MetaData, Table, select

from app.modules.identity.models import new_id

revision = "0010_unique_delivery"
down_revision = "0009_manual_review"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if op.get_context().as_sql:
        raise RuntimeError("Delivery backfill requires an online Alembic upgrade.")
    connection = op.get_bind()
    metadata = MetaData()
    position, adoption, creation, output, file = [
        Table(name, metadata, autoload_with=connection)
        for name in (
            "delivery_positions", "image_adoptions", "creations", "creation_outputs",
            "private_files",
        )
    ]
    empty = connection.execute(
        select(position)
        .outerjoin(adoption, adoption.c.position_id == position.c.id)
        .where(adoption.c.position_id.is_(None), position.c.purpose != "video")
        .order_by(position.c.id)
    ).mappings().all()
    for row in empty:
        candidates = connection.execute(
            select(output.c.id)
            .join(creation, creation.c.id == output.c.creation_id)
            .join(file, file.c.id == output.c.file_id)
            .outerjoin(adoption, adoption.c.output_id == output.c.id)
            .where(
                creation.c.tenant_id == row["tenant_id"],
                creation.c.task_id == row["task_id"],
                creation.c.product_id == row["product_id"],
                creation.c.purpose == row["purpose"],
                output.c.status == "approved",
                file.c.tenant_id == row["tenant_id"],
                file.c.status == "ready",
                file.c.version == output.c.file_version,
                file.c.object_key.is_not(None),
                file.c.content_type.in_(("image/png", "image/jpeg", "image/webp")),
                adoption.c.output_id.is_(None),
            )
            .limit(2)
        ).scalars().all()
        if len(candidates) == 1:
            connection.execute(adoption.insert().values(
                position_id=row["id"], output_id=candidates[0], token=new_id(),
            ))
            connection.execute(
                position.update().where(position.c.id == row["id"]).values(status="adopted")
            )


def downgrade() -> None:
    # Filled positions are now ordinary selections and may still be in use.
    pass
