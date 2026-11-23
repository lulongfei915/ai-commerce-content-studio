from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.shared.db import Base


class Adoption(Base):
    __tablename__ = "image_adoptions"

    position_id: Mapped[str] = mapped_column(ForeignKey("delivery_positions.id"), primary_key=True)
    output_id: Mapped[str] = mapped_column(ForeignKey("creation_outputs.id"), unique=True)
    token: Mapped[str] = mapped_column(String(36))
