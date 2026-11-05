"""Track live processing progress per meeting (streamed to the browser)."""

import sqlalchemy as sa

from alembic import op

revision = "004"
down_revision = "003"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("meetings", sa.Column("progress", sa.JSON(), nullable=True))


def downgrade():
    op.drop_column("meetings", "progress")
