"""Keep an object reference and measured size for archived image responses."""

import sqlalchemy as sa
from alembic import op

revision = "0011_gpt_image_results"
down_revision = "0010_unique_delivery"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("image_steps", sa.Column("result_object_key", sa.String(256), nullable=True))
    op.add_column("image_steps", sa.Column("result_size", sa.String(24), nullable=True))


def downgrade() -> None:
    op.drop_column("image_steps", "result_size")
    op.drop_column("image_steps", "result_object_key")
