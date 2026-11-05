"""Summary columns for server-side search, sorting and pagination of the meeting list."""

import sqlalchemy as sa

from alembic import op
from app.db import backfill_summaries

revision = "006"
down_revision = "005"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("meetings", sa.Column("speakers", sa.JSON(), nullable=True))
    op.add_column("meetings", sa.Column("duration", sa.Integer(), nullable=True))
    op.add_column("meetings", sa.Column("turn_count", sa.Integer(), nullable=True))
    backfill_summaries(op.get_bind())
    op.create_index("ix_meetings_created_at", "meetings", ["created_at"])
    op.create_index("ix_meetings_status", "meetings", ["status"])


def downgrade():
    op.drop_index("ix_meetings_status", "meetings")
    op.drop_index("ix_meetings_created_at", "meetings")
    op.drop_column("meetings", "turn_count")
    op.drop_column("meetings", "duration")
    op.drop_column("meetings", "speakers")
