ALTER TABLE "material_requirements" ADD CONSTRAINT "material_requirements_wbsItemId_fkey" FOREIGN KEY ("wbsItemId") REFERENCES "wbs_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
