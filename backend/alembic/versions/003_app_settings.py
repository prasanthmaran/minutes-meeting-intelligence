"""Store connection settings (encrypted API keys) so restarts keep them."""

import sqlalchemy as sa

from alembic import op

revision = "003"
down_revision = "002"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "app_settings",
        sa.Column("name", sa.String(64), primary_key=True),
        sa.Column("value", sa.Text(), nullable=False),
        sa.Column("updated_at", sa.String(), nullable=False),
    )
    if op.get_bind().dialect.name == "postgresql":
        # Keep Supabase's public Data API away from stored (encrypted) keys.
        op.execute("ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY")


def downgrade():
    op.drop_table("app_settings")
