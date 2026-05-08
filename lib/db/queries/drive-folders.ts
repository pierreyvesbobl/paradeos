import "server-only";

import { driveFolders } from "@/db/schema/drive-folders";
import { db } from "@/lib/db/server";
import type { DriveFileSubjectType } from "@/lib/schemas/drive-files";
import { and, eq } from "drizzle-orm";

export async function getDriveFolderForSubject(
  subjectType: DriveFileSubjectType,
  subjectId: string,
) {
  const conn = await db();
  const [row] = await conn
    .select()
    .from(driveFolders)
    .where(and(eq(driveFolders.subjectType, subjectType), eq(driveFolders.subjectId, subjectId)))
    .limit(1);
  return row ?? null;
}
