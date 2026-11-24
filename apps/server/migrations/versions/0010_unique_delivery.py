"""Fill existing empty delivery positions with a single valid approved version."""

from alembic import op
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.delivery.models import Adoption
from app.modules.delivery.service import fill_open_position
from app.modules.tasks.models import DeliveryPosition

revision = "0010_unique_delivery"
down_revision = "0009_manual_review"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if op.get_context().as_sql:
        raise RuntimeError("Delivery backfill requires an online Alembic upgrade.")
    with Session(bind=op.get_bind(), autoflush=False, join_transaction_mode="rollback_only") as db:
        positions = db.scalars(
            select(DeliveryPosition)
            .outerjoin(Adoption, Adoption.position_id == DeliveryPosition.id)
            .where(Adoption.position_id.is_(None))
            .order_by(DeliveryPosition.id)
            .with_for_update()
        ).all()
        for position in positions:
            fill_open_position(db, position)
        db.commit()


def downgrade() -> None:
    # Filled positions are now ordinary selections and may still be in use.
    pass
