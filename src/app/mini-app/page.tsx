import type { Metadata } from 'next';
import { TelegramMiniAppClient } from '@/components/Telegram/TelegramMiniAppClient';

export const metadata: Metadata = {
  title: "AI Models | Sam'Space Planner",
  description: 'Planner AI models and conversations in Telegram.',
};

export default function TelegramMiniAppPage() {
  return <TelegramMiniAppClient />;
}
