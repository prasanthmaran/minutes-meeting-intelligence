"""Keep the uploaded transcript file exactly as received."""

import sqlalchemy as sa

from alembic import op

revision = "005"
down_revision = "004"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("meetings", sa.Column("source_text", sa.Text(), nullable=True))
    op.add_column("meetings", sa.Column("source_name", sa.String(255), nullable=True))


def downgrade():
    op.drop_column("meetings", "source_name")
    op.drop_column("meetings", "source_text")
