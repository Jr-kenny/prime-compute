-- 0012_service_types.sql
-- Widen the resource_type check on providers and rents to allow VPN and Worker.
-- Postgres names inline column checks <table>_<column>_check.
alter table providers drop constraint if exists providers_resource_type_check;
alter table providers add constraint providers_resource_type_check
  check (resource_type in ('GPU','CPU','Storage','Full Server','VPN','Worker'));

alter table rents drop constraint if exists rents_resource_type_check;
alter table rents add constraint rents_resource_type_check
  check (resource_type in ('GPU','CPU','Storage','Full Server','VPN','Worker'));
