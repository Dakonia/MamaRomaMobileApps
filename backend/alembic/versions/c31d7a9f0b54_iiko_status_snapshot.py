"""iiko status snapshot

Revision ID: c31d7a9f0b54
Revises: 7b8f1397c3bd
Create Date: 2026-08-26 21:30:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c31d7a9f0b54"
down_revision: str | Sequence[str] | None = "7b8f1397c3bd"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("orders", sa.Column("iiko_status", sa.String(length=40), nullable=True))
    op.add_column(
        "orders", sa.Column("iiko_status_updated_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column("orders", sa.Column("iiko_problem_comment", sa.Text(), nullable=True))
    op.add_column("orders", sa.Column("iiko_courier_name", sa.String(length=120), nullable=True))
    op.add_column("orders", sa.Column("iiko_cancel_cause", sa.String(length=300), nullable=True))
    op.add_column("orders", sa.Column("iiko_cancel_comment", sa.String(length=500), nullable=True))
    op.add_column(
        "orders",
        sa.Column(
            "iiko_items",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
    )
    op.alter_column("orders", "iiko_items", server_default=None)
    op.add_column(
        "orders", sa.Column("iiko_items_changed_at", sa.DateTime(timezone=True), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("orders", "iiko_items_changed_at")
    op.drop_column("orders", "iiko_items")
    op.drop_column("orders", "iiko_cancel_comment")
    op.drop_column("orders", "iiko_cancel_cause")
    op.drop_column("orders", "iiko_courier_name")
    op.drop_column("orders", "iiko_problem_comment")
    op.drop_column("orders", "iiko_status_updated_at")
    op.drop_column("orders", "iiko_status")
