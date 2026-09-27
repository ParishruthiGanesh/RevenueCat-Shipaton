import React from 'react';
import {
  Archive,
  Backpack,
  BatteryCharging,
  BookOpen,
  Box,
  Cable,
  Camera,
  CookingPot,
  FileText,
  Glasses,
  Headphones,
  Key,
  Laptop,
  Luggage,
  Package,
  Pill,
  Plug,
  Shirt,
  Smartphone,
  Watch,
  Wrench,
  type LucideIcon,
} from 'lucide-react-native';
import { useTheme } from '../theme';

const RULES: [RegExp, LucideIcon][] = [
  [/passport|document|paper|envelope|certificate|file/i, FileText],
  [/key/i, Key],
  [/glasses|sunglasses|spectacles/i, Glasses],
  [/airpods|earbuds|headphone|headset|earphone/i, Headphones],
  [/charger|adapter|plug|brick/i, Plug],
  [/cable|cord|wire|hdmi|usb/i, Cable],
  [/power bank|battery/i, BatteryCharging],
  [/laptop|macbook|computer/i, Laptop],
  [/phone|iphone/i, Smartphone],
  [/camera|lens/i, Camera],
  [/watch/i, Watch],
  [/pill|medic|meds/i, Pill],
  [/backpack|bag|pouch/i, Backpack],
  [/suitcase|luggage/i, Luggage],
  [/shirt|cloth|coat|jacket|sweater|scarf/i, Shirt],
  [/drill|screwdriver|tool|hammer|wrench/i, Wrench],
  [/blender|grinder|mug|pot|pan|kitchen/i, CookingPot],
  [/book|notebook|album/i, BookOpen],
  [/box|bin|crate/i, Box],
  [/drawer|cabinet|shelf/i, Archive],
];

export function glyphFor(name = '', category = ''): LucideIcon {
  const s = `${name} ${category}`;
  return RULES.find(([re]) => re.test(s))?.[1] ?? Package;
}

export function ObjectGlyph({ name, category, size = 28, color }: { name?: string; category?: string; size?: number; color?: string }) {
  const { c } = useTheme();
  return React.createElement(glyphFor(name, category), { size, color: color ?? c.faint, strokeWidth: 1.6 });
}
