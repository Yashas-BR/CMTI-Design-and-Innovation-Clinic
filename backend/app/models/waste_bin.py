"""Example database model for Waste Bin."""

from sqlalchemy import Boolean, Float, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class WasteBin(Base, TimestampMixin):
    """Waste Bin model for tracking waste containers."""

    __tablename__ = "waste_bins"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    bin_id: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    location: Mapped[str] = mapped_column(String(255))
    capacity: Mapped[float] = mapped_column(Float)  # in kg
    current_level: Mapped[float] = mapped_column(Float, default=0.0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    latitude: Mapped[float] = mapped_column(Float, nullable=True)
    longitude: Mapped[float] = mapped_column(Float, nullable=True)

    def __repr__(self) -> str:
        """String representation of WasteBin."""
        return f"<WasteBin(bin_id={self.bin_id}, location={self.location})>"
