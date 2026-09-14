-- The 10seconds transfer job was deliberately removed during speed tuning
-- (2026-09-09): it duplicated content the PODCASTS job also uploads, and its
-- container + log file were deleted on RED. The dashboard row it left behind
-- reads as a scary "no update in N min" warning forever — drop it. The data
-- it uploaded stays in the vault; PODCASTS skips those files and finishes
-- the folder.
DELETE FROM storage_transfer_commands WHERE name = '10seconds';
DELETE FROM storage_transfer_reports WHERE name = '10seconds';
