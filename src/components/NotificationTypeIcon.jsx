import {
  Bell,
  CheckCircle2,
  Clock,
  XCircle,
  FileText,
  Briefcase,
  TrendingUp,
  Trophy,
  MessageCircle,
  Target,
  ShieldAlert,
  History,
} from "lucide-react";
import { getNotificationMeta } from "../utils/notificationMeta";

const ICONS = { Bell, CheckCircle2, Clock, XCircle, FileText, Briefcase, TrendingUp, Trophy, MessageCircle, Target, ShieldAlert, History };

/** The icon a notification type names in notificationTargets.js. */
export default function NotificationTypeIcon({ type, size = 18, className = "text-muted-foreground" }) {
  const Icon = ICONS[getNotificationMeta(type).icon] ?? Bell;
  return <Icon size={size} className={className} />;
}
