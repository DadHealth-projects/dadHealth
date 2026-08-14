import type { NotificationType } from "@/types/database";

export type NotificationLink =
  | "/"
  | "/bond"
  | "/fitness"
  | "/progress"
  | "/mind"
  | "/community";

export type NotificationPayload = {
  type: NotificationType;
  heading: string;
  content: string;
  link: NotificationLink;
  data?: Record<string, string>;
};

