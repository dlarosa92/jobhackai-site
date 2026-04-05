/**
 * JobHackAI Blog Data
 *
 * HOW TO ADD A NEW POST:
 * 1. Copy marketing/blog/post-template.html → marketing/blog/your-slug.html
 * 2. Edit the HTML file: update title, meta description, date, category, body content
 * 3. Add one new object to the BLOG_POSTS array below (most recent post first)
 * 4. Add the URL to marketing/sitemap.xml
 * 5. Deploy
 *
 * Slug must match the filename: slug "my-post" → file "blog/my-post.html"
 */

window.BLOG_POSTS = [
  {
    slug: 'behavioral-interview-anxiety',
    title: 'Behavioral Interview Anxiety: Why 85% of Job Seekers Feel Unprepared (And the Fix)',
    excerpt: 'The gap between your achievements and your ability to articulate them under pressure is where careers stall. Learn the SAO framework and text-based practice method that closes the Experience Gap.',
    category: 'Interview Prep',
    date: '2026-04-05',
    readTime: 7,
    author: 'JobHackAI Team',
    featured: false,
  },
  {
    slug: 'the-2-percent-rule',
    title: 'The 2% Rule: Why 98% of Job Applications Are Ghosted in 2026 (And the Fix)',
    excerpt: 'For every 100 generic applications, only two people get an interview. Learn why tailored resumes and AI-optimized cover letters get you into the 5% interview club.',
    category: 'Job Search',
    date: '2026-04-05',
    readTime: 8,
    author: 'JobHackAI Team',
    featured: false,
  },
  {
    slug: 'mock-interview-online',
    title: 'Mock Interview Online: Why Real-Time Practice Is Your Secret Weapon',
    excerpt: 'Stop reading interview tips and start practicing. Real-time mock interview sessions build the structured communication skills that actually win job offers.',
    category: 'Interview Prep',
    date: '2026-03-18',
    readTime: 9,
    author: 'JobHackAI Team',
    featured: true,
  },
  {
    slug: 'ats-optimization-playbook',
    title: 'The ATS Optimization Playbook: Get Your Resume Past the Bots',
    excerpt: 'Most resumes are rejected before a human ever reads them. Here is the exact framework to align your resume with ATS filters without losing your voice or authenticity.',
    category: 'Resume',
    date: '2026-02-24',
    readTime: 8,
    author: 'JobHackAI Team',
    featured: false,
  },
  {
    slug: 'linkedin-profile-optimization',
    title: 'LinkedIn Profile Optimization: Turn Your Profile Into a Recruiter Magnet',
    excerpt: 'A weak LinkedIn headline costs you interviews every week. Learn how to position your profile so recruiters find you, message you, and move you to the top of the pile.',
    category: 'LinkedIn',
    date: '2026-02-17',
    readTime: 7,
    author: 'JobHackAI Team',
    featured: false,
  },
  {
    slug: '7-day-interview-prep-routine',
    title: 'The 7-Day Interview Prep Routine That Builds Real Confidence',
    excerpt: 'Most candidates cram the night before. This structured 7-day routine builds the kind of deep fluency that lets you answer any question naturally, not robotically.',
    category: 'Interview Prep',
    date: '2026-02-10',
    readTime: 6,
    author: 'JobHackAI Team',
    featured: false,
  },
];
