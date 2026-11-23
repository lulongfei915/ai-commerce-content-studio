"""Separate quick and canvas drafts while retaining legacy records."""

import sqlalchemy as sa
from alembic import op

revision = "0006_creation_entries"
down_revision = "0005_canvas"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("creations", sa.Column("entry", sa.String(12), nullable=True))
    creations = sa.table(
        "creations",
        sa.column("id"),
        sa.column("tenant_id"),
        sa.column("task_id"),
        sa.column("slot"),
        sa.column("entry"),
    )
    outputs = sa.table("creation_outputs", sa.column("id"), sa.column("creation_id"))
    layouts = sa.table(
        "canvas_layouts",
        sa.column("tenant_id"),
        sa.column("task_id"),
        sa.column("positions", sa.JSON()),
    )
    connection = op.get_bind()
    # The old UI created extra slots only from the canvas.
    connection.execute(
        creations.update().where(creations.c.slot != "primary").values(entry="canvas")
    )
    for tenant, task, positions in connection.execute(sa.select(layouts)).all():
        ids = [
            point["id"].split(":", 1)[1]
            for point in positions
            if point["id"].startswith("creation:")
        ]
        result_ids = [
            point["id"].split(":", 1)[1] for point in positions if point["id"].startswith("result:")
        ]
        if ids or result_ids:
            connection.execute(
                creations.update()
                .where(
                    creations.c.tenant_id == tenant,
                    creations.c.task_id == task,
                    sa.or_(
                        creations.c.id.in_(ids),
                        creations.c.id.in_(
                            sa.select(outputs.c.creation_id).where(outputs.c.id.in_(result_ids))
                        ),
                    ),
                )
                .values(entry="canvas")
            )
    # Unpositioned primary drafts have no reliable mode evidence. NULL records that ambiguity.


def downgrade() -> None:
    op.drop_column("creations", "entry")
