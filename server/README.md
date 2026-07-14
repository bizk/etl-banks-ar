
### Docker

Build 

`docker compose up -d --build`

The root compose file reuses the existing `tostado-etl` MySQL container through
the host's published port (`3306`); it does not create a MySQL service or volume.
Set `DB_HOST`, `DB_NAME`, `DB_USER`, and `DB_PASSWORD` in the root `.env` to the
credentials used by that container.

Stop the app containers

`docker compose down`

