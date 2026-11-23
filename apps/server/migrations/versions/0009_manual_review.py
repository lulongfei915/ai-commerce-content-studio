"""Move undecided legacy AI inspection results to manual review."""

import sqlalchemy as sa
from alembic import op

revision = "0009_manual_review"
down_revision = "0008_asset_family"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        sa.text(
            """
            UPDATE image_steps
            SET lease = NULL, error = NULL
            WHERE decision IS NULL AND output_id IN (
                SELECT id FROM creation_outputs
                WHERE status IN ('checking', 'inspecting', 'blocked', 'check_error')
            )
            """
        )
    )
    op.execute(
        sa.text(
            """
            UPDATE creation_outputs
            SET status = CASE WHEN EXISTS (
                SELECT 1 FROM private_files AS file
                JOIN creations AS draft ON draft.tenant_id = file.tenant_id
                WHERE draft.id = creation_outputs.creation_id
                  AND file.id = creation_outputs.file_id
                  AND file.version = creation_outputs.file_version
                  AND file.status = 'ready'
                  AND file.object_key IS NOT NULL AND file.object_key <> ''
                  AND file.content_type = 'image/png'
            ) THEN 'pending_review' ELSE 'result_unavailable' END
            WHERE status IN ('checking', 'inspecting', 'blocked', 'check_error')
              AND EXISTS (
                SELECT 1 FROM image_steps AS step
                WHERE step.output_id = creation_outputs.id AND step.decision IS NULL
              )
            """
        )
    )
    op.execute(
        sa.text(
            """
            UPDATE studio_model_calls SET status = 'unverified'
            WHERE kind = 'quality' AND status = 'pending'
            """
        )
    )


def downgrade() -> None:
    # Existing manual decisions and migrated review states are retained.
    pass
