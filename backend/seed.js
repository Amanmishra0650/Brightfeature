export const categories = ['PET', 'CTET', 'STET', 'BPSC TRE 4.0', 'Bihar Police SI'];
export function seedData() {
  const notes = [
    ['pet', 'PET', 'PET Exam Preparation Notes', 149, 299, 'Your complete foundation for PET 2026.', 180, 12, 'General studies • Reasoning • Current affairs', 'Popular choice'],
    ['ctet', 'CTET', 'CTET Preparation Notes', 249, 399, 'Build your teaching journey with confidence.', 240, 16, 'Child development • Pedagogy • Language', 'Bestseller'],
    ['stet', 'STET', 'STET Preparation Notes', 249, 399, 'Focused preparation for Bihar STET.', 210, 14, 'Subject knowledge • Revision • Practice', 'Exam essentials'],
    ['bpsc', 'BPSC TRE 4.0', 'BPSC School Teacher TRE 4.0', 349, 599, 'Everything you need for your next big step.', 320, 20, 'Syllabus • PYQ • Practice sets • Current affairs', 'Complete pack'],
    ['si', 'Bihar Police SI', 'Bihar Police Sub-Inspector Notes', 249, 349, 'A smarter approach to your uniform dream.', 225, 15, 'General knowledge • Maths • Reasoning', 'Student favourite'],
  ].map(([id, category, title, price, originalPrice, description, pages, chapters, topics, badge]) => ({ id, category, title, price, originalPrice, description, pages, chapters, topics, badge, published: true, language: 'Hindi + English' }));
  return { notes, settings: { phone: '9161868600', offerTitle: 'A little investment. A brighter future.', offerSubtitle: 'Give your preparation the right direction with exam-focused notes at special prices.', discount: 50 }, orders: [
    { id: 'BF-DEMO1001', userId: 'seed-1', name: 'Aarav Sharma', email: 'aarav@example.com', noteId: 'ctet', title: notes[1].title, amount: 249, status: 'Demo access', createdAt: '2026-09-12T10:00:00.000Z' },
    { id: 'BF-DEMO1002', userId: 'seed-2', name: 'Priya Singh', email: 'priya@example.com', noteId: 'bpsc', title: notes[3].title, amount: 349, status: 'Demo access', createdAt: '2026-09-12T11:30:00.000Z' },
    { id: 'BF-DEMO1003', userId: 'seed-3', name: 'Rohit Kumar', email: 'rohit@example.com', noteId: 'pet', title: notes[0].title, amount: 149, status: 'Pending', createdAt: '2026-09-13T09:15:00.000Z' },
    { id: 'BF-DEMO1004', userId: 'seed-4', name: 'Anjali Verma', email: 'anjali@example.com', noteId: 'stet', title: notes[2].title, amount: 249, status: 'Demo access', createdAt: '2026-09-13T12:40:00.000Z' },
  ] };
}
