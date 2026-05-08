import { z } from "zod";

export const toggleCalendarSyncSchema = z.object({
  calendarId: z.string().uuid(),
  enabled: z.boolean(),
});

export const attributeCalendarEventSchema = z.object({
  calendarEventId: z.string().uuid(),
  projectId: z.string().uuid().nullable().optional(),
  taskId: z.string().uuid().nullable().optional(),
  contactId: z.string().uuid().nullable().optional(),
  kind: z.enum(["planned", "actual"]).optional(),
});

export const unattributeTimeEntrySchema = z.object({
  timeEntryId: z.string().uuid(),
});
