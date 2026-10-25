import { NextResponse } from 'next/server';

const websiteOnly = () => NextResponse.json({
  error: 'Book quizzes are available on the website only.',
  delivery: 'website',
}, { status: 410 });

export async function GET() {
  return websiteOnly();
}

export async function POST() {
  return websiteOnly();
}
