import {
  ArrowUp,
  Box,
  ChevronDown,
  Clock,
  FileText,
  Inbox,
  Moon,
  Plus,
  Search,
  Send,
  Square,
  Sun,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";

const ICONS = {
  agent: Send,
  "arrow-up": ArrowUp,
  "chevron-down": ChevronDown,
  clock: Clock,
  close: X,
  cube: Box,
  document: FileText,
  inbox: Inbox,
  moon: Moon,
  plus: Plus,
  search: Search,
  stop: Square,
  sun: Sun,
  users: Users,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof ICONS;

interface IconProps {
  className?: string;
  name: IconName;
  size?: number;
}

export const Icon = ({ className, name, size = 16 }: IconProps) => {
  const Glyph = ICONS[name];
  return (
    <Glyph
      aria-hidden="true"
      className={className}
      focusable="false"
      size={size}
      strokeWidth={1.6}
    />
  );
};
