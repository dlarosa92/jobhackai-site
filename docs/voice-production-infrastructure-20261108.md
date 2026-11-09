# QA-verified voice infrastructure promotion

This prerequisite promotes only infrastructure verified in QA through PR #1170
and used by the recorded QA interview on revision 82d60170e74de6aeb676d1c5b2958eb92dd1125b.
The worker source is identical to that active QA revision. The provider helper
uses the earlier QA prerequisite version, so the existing production app keeps
its current audio-start behavior until the separately validated app promotion.

The guarded main release checks exact branch identity, existing production D1,
namespace, secret type and enabled scheduler. It records a recovery bookmark,
applies only missing 033/035, deploys the matching worker and verifies readback.
Migration 034 remains excluded. Existing provider holds are preserved.

Production baseline: 823ee4dc0f3f66e7b28920fbdbcd7be9e181b80c.
QA prerequisite source: bbed8419fd6f48f315a5b2a4ae0543edee427efd.
No direct untested feature promotion is involved. Infrastructure must finish
and be verified before the new application is merged.
