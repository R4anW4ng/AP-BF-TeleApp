-- Reference data: the four Cell Groups of zone AP. Existing rows are kept.
INSERT INTO "cell_groups" ("id", "code", "name", "sortOrder") VALUES
  ('cg_ap1', 'AP1', 'Cell Group AP1', 0),
  ('cg_ap2', 'AP2', 'Cell Group AP2', 1),
  ('cg_ap3', 'AP3', 'Cell Group AP3', 2),
  ('cg_ap4', 'AP4', 'Cell Group AP4', 3)
ON CONFLICT ("code") DO NOTHING;
