"""Enable row-level security so hosted Postgres APIs cannot read app tables.

Supabase exposes the public schema through its Data API using publishable/anon keys.
With RLS enabled and no policies, those API roles see nothing. The backend connects
as the table owner, which bypasses RLS, so the application is unaffected.
"""

from alembic import op

revision = "002"
down_revision = "001"
branch_labels = None
depends_on = None

TABLES = ("meetings", "chunks", "messages", "alembic_version")


def upgrade():
    if op.get_bind().dialect.name != "postgresql":
        return
    for table in TABLES:
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")


def downgrade():
    if op.get_bind().dialect.name != "postgresql":
        return
    for table in TABLES:
        op.execute(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY")
