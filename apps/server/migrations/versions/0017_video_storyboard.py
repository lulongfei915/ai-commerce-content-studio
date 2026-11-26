"""Persist the per-draft storyboard confirmation."""

import sqlalchemy as sa
from alembic import op

revision = "0017_video_storyboard"
down_revision = "0016_discard_batch_item"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("creations", sa.Column("storyboard", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("creations", "storyboard")
