"""staff roles and permissions

Revision ID: a1c7f3b90e42
Revises: 88098af8c760
Create Date: 2026-09-03 14:10:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a1c7f3b90e42"
down_revision: str | Sequence[str] | None = "88098af8c760"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


ROLES = (
    "owner",
    "network_manager",
    "delivery_operator",
    "marketing",
    "courier",
    "restaurant",
)

OLD_ROLES = ("owner", "manager")


def _check(values: Sequence[str]) -> str:
    listed = ", ".join(f"'{value}'" for value in values)
    return f"role IN ({listed})"


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "staff_users",
        sa.Column(
            "permissions",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
    )
    op.add_column(
        "staff_users",
        sa.Column(
            "restaurant_ids",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
    )
    op.add_column("staff_users", sa.Column("invited_by_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        op.f("fk_staff_users_invited_by_id_staff_users"),
        "staff_users",
        "staff_users",
        ["invited_by_id"],
        ["id"],
        ondelete="SET NULL",
    )

    # Ограничение снимаем до переименования: иначе UPDATE упрётся в старый список
    op.drop_constraint(op.f("ck_staff_users_staffrole"), "staff_users", type_="check")
    op.execute("UPDATE staff_users SET role = 'network_manager' WHERE role = 'manager'")
    op.create_check_constraint("staffrole", "staff_users", _check(ROLES))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint(op.f("ck_staff_users_staffrole"), "staff_users", type_="check")
    # Ролей стало больше, чем было: всех, кроме владельцев, сводим в manager
    op.execute("UPDATE staff_users SET role = 'manager' WHERE role <> 'owner'")
    op.create_check_constraint("staffrole", "staff_users", _check(OLD_ROLES))

    op.drop_constraint(
        op.f("fk_staff_users_invited_by_id_staff_users"), "staff_users", type_="foreignkey"
    )
    op.drop_column("staff_users", "invited_by_id")
    op.drop_column("staff_users", "restaurant_ids")
    op.drop_column("staff_users", "permissions")
