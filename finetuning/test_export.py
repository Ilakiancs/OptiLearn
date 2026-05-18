import asyncio
import aiosqlite
import sys
sys.path.insert(0, 'optilearn')

from app.services.student_transfer import build_student_bundle, bundle_to_zip_bytes
from app.core.config import settings

async def test_export():
    # Get first student
    async with await aiosqlite.connect(settings.DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT id, pin_visible FROM students LIMIT 1")
        row = await cur.fetchone()
        if not row:
            print("No students found")
            return
        student_id = row['id']
        pin = row['pin_visible']
        print(f"Testing with student {student_id}, PIN: {pin}")
    
    # Try to build bundle
    try:
        bundle = await build_student_bundle(student_id)
        print(f"✓ Bundle built: {len(bundle)} keys")
        for key in bundle:
            if isinstance(bundle[key], list):
                print(f"  - {key}: {len(bundle[key])} items")
            elif isinstance(bundle[key], dict):
                print(f"  - {key}: {len(bundle[key])} keys")
            else:
                print(f"  - {key}: {type(bundle[key])}")
    except Exception as e:
        print(f"✗ Bundle failed: {e}")
        import traceback
        traceback.print_exc()
        return
    
    # Try to create ZIP
    try:
        zip_bytes = bundle_to_zip_bytes(bundle, pin)
        print(f"✓ ZIP created: {len(zip_bytes)} bytes")
    except Exception as e:
        print(f"✗ ZIP failed: {e}")
        import traceback
        traceback.print_exc()

if __name__ == '__main__':
    asyncio.run(test_export())
