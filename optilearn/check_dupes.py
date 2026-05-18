import sqlite3
c = sqlite3.connect('data/optilearn.db')
rows = c.execute(
    "SELECT lower(username) as u, COUNT(*) as n, GROUP_CONCAT(id) as ids "
    "FROM students WHERE username IS NOT NULL AND username != '' "
    "GROUP BY lower(username) HAVING COUNT(*) > 1"
).fetchall()
if rows:
    print('DUPLICATE USERNAMES FOUND:')
    for r in rows:
        print(f'  username={r[0]}  count={r[1]}  ids={r[2]}')
else:
    print('No duplicate usernames in DB.')

all_students = c.execute(
    "SELECT id, name, username, pin_visible FROM students WHERE is_registered=1 ORDER BY username"
).fetchall()
print(f'\nAll registered students ({len(all_students)}):')
for s in all_students:
    print(f'  id={s[0][:8]}...  name={s[1]}  username={s[2]}  pin={s[3]}')
c.close()
