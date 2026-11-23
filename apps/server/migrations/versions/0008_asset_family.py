"""Keep the asset identity stable across image reworks."""

import sqlalchemy as sa
from alembic import op

revision = "0008_asset_family"
down_revision = "0007_image_production"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("creation_outputs", sa.Column("asset_id", sa.String(36), nullable=True))
    op.create_index("ix_creation_outputs_asset_id", "creation_outputs", ["asset_id"])


def downgrade() -> None:
    op.drop_index("ix_creation_outputs_asset_id", table_name="creation_outputs")
    op.drop_column("creation_outputs", "asset_id")
