ALTER TABLE "daily_plans" ADD CONSTRAINT "daily_plans_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "daily_plans" ADD CONSTRAINT "daily_plans_wbsItemId_fkey" FOREIGN KEY ("wbsItemId") REFERENCES "wbs_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
