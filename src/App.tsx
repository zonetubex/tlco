import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { getDb, getDbConfig, getDbName, switchDatabase, initDbConfig, isDbConfigured, DATABASE_OPTIONS, createAdapter } from './lib/db';
import type { DatabaseConfig, DatabaseType, SettingRow, ClickLogData } from './lib/db';

// ─── Types ───────────────────────────────────────────────────────────
interface ShortLinkData {
  id: string;
  code: string;
  url: string;
  clicks: number;
  created_at: string;
}

interface ArticleData {
  category: string;
  publishDate: string;
  author: string;
  readTime: string;
  title: string;
  slug: string;
  metaDescription: string;
  content: string;
}

interface SettingsData {
  custom_domain: string;
  custom_domains: string;
  random_domain: boolean;
  site_name: string;
  theme_color: string;
  theme_mode: string;
}

type Tab = 'home' | 'create' | 'settings' | 'tutorial';

// ─── Toast System ────────────────────────────────────────────────────
interface ToastData {
  id: number;
  title: string;
  description?: string;
  variant?: 'default' | 'destructive';
}

let toastId = 0;

function useToast() {
  const [toasts, setToasts] = useState<ToastData[]>([]);

  const addToast = useCallback((data: Omit<ToastData, 'id'>) => {
    const id = ++toastId;
    setToasts(prev => [...prev, { ...data, id }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 3000);
  }, []);

  const toast = useCallback((data: { title: string; description?: string; variant?: 'default' | 'destructive' }) => {
    addToast(data);
  }, [addToast]);

  const removeToast = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  return { toasts, toast, removeToast };
}

function ToastContainer({ toasts, onRemove }: { toasts: ToastData[]; onRemove: (id: number) => void }) {
  if (toasts.length === 0) return null;
  return (
    <div className="fixed bottom-20 md:bottom-6 right-4 z-[100] flex flex-col gap-2 max-w-sm">
      {toasts.map(t => (
        <div
          key={t.id}
          className={`animate-toast-in px-4 py-3 rounded-xl shadow-lg border backdrop-blur-xl text-sm cursor-pointer ${
            t.variant === 'destructive'
              ? 'bg-red-500/90 border-red-500/50 text-white'
              : 'bg-gray-800/90 border-gray-700 text-white'
          }`}
          onClick={() => onRemove(t.id)}
        >
          <div className="font-semibold">{t.title}</div>
          {t.description && <div className="text-gray-300 text-xs mt-0.5">{t.description}</div>}
        </div>
      ))}
    </div>
  );
}

// ─── Constants ───────────────────────────────────────────────────────
function ensureProtocol(url: string): string {
  if (!url.trim()) return '';
  const trimmed = url.trim().replace(/\/+$/, '');
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return 'https://' + trimmed;
}

function getDomain(customDomain?: string, customDomains?: string, randomDomain?: boolean): string {
  const domains = customDomains && customDomains.trim()
    ? customDomains.split(',').map(d => d.trim()).filter(Boolean)
    : [];
  if (domains.length > 0) {
    const domain = randomDomain
      ? domains[Math.floor(Math.random() * domains.length)]
      : domains[0];
    return ensureProtocol(domain) + '/#';
  }
  if (customDomain && customDomain.trim()) {
    return ensureProtocol(customDomain) + '/#';
  }
  if (typeof window !== 'undefined') {
    return window.location.origin + window.location.pathname.replace(/\/$/, '') + '/#';
  }
  return '';
}

const RANDOM_EMOJIS = [
  '🔞', '🔞', '🔞', '🔞', '🔞',
  '▶️', '▶️', '▶️', '▶️',
  '⏺️', '⏺️', '⏺️',
  '▶️', '⏸️', '⏹️',
  '👉', '👆', '👇', '👈', '☝️',
  '▶️', '⏩', '⏪',
  '🎥', '🎬', '📹', '📽️', '🎞️',
  '⚠️', '❗', '❕', '‼️',
  '📢', '🔔', '📣',
];

function getRandomEmoji(): string {
  return RANDOM_EMOJIS[Math.floor(Math.random() * RANDOM_EMOJIS.length)];
}

// ─── User-Agent Parser ──────────────────────────────────────────────
function parseUserAgent(ua: string): { device: string; browser: string; os: string } {
  if (!ua) return { device: 'Unknown', browser: 'Unknown', os: 'Unknown' };
  const uaLower = ua.toLowerCase();

  // Device
  let device = 'Desktop';
  if (/mobile|android(?!.*tablet)|iphone|ipod|blackberry|opera mini|iemobile/i.test(ua)) {
    device = 'Mobile';
  } else if (/ipad|android(.*tablet)|tablet|kindle|silk/i.test(ua)) {
    device = 'Tablet';
  }

  // Browser
  let browser = 'Other';
  if (uaLower.includes('firefox')) browser = 'Firefox';
  else if (uaLower.includes('edg/')) browser = 'Edge';
  else if (uaLower.includes('opr/') || uaLower.includes('opera')) browser = 'Opera';
  else if (uaLower.includes('chrome')) browser = 'Chrome';
  else if (uaLower.includes('safari')) browser = 'Safari';
  else if (uaLower.includes('msie') || uaLower.includes('trident')) browser = 'IE';

  // OS
  let os = 'Other';
  if (uaLower.includes('windows')) os = 'Windows';
  else if (uaLower.includes('android')) os = 'Android';
  else if (/iphone|ipad|ipod/.test(uaLower)) os = 'iOS';
  else if (uaLower.includes('mac os')) os = 'macOS';
  else if (uaLower.includes('linux')) os = 'Linux';
  else if (uaLower.includes('cros')) os = 'ChromeOS';

  return { device, browser, os };
}

const DEFAULT_WA_URL = '';

const ARTICLES: ArticleData[] = [
  { category: 'Technology', publishDate: '2025-01-15', author: 'James Mitchell', readTime: '5 min read', title: 'How Artificial Intelligence Is Reshaping the Modern Workplace in 2025', slug: 'ai-reshaping-workplace-2025', metaDescription: 'Exploring the profound impact of artificial intelligence on global industries and how professionals must adapt to thrive alongside new technologies.', content: '<p>Artificial intelligence is no longer just a buzzword discussed in tech circles. In 2025, AI has become an integral part of industries ranging from healthcare and education to manufacturing and logistics. Major corporations are adopting AI at scale to automate workflows that previously required significant manual effort and time investment.</p><p>According to a recent McKinsey report, approximately 60% of current jobs have at least 30% of their activities that could be automated with existing AI technology. This does not mean AI will replace humans entirely — rather, it highlights the growing importance of human-AI collaboration to produce better, more efficient outcomes across every sector.</p><p>To stay competitive, professionals must continuously learn and develop new skills. Abilities like critical thinking, creativity, and emotional intelligence are becoming increasingly valuable precisely because they remain difficult for machines to replicate. Platforms such as Coursera, edX, and Udemy offer accessible courses on AI literacy and machine learning fundamentals for learners at every level.</p>' },
  { category: 'Health', publishDate: '2025-01-18', author: 'Dr. Sarah Bennett', readTime: '4 min read', title: '5 Morning Habits That Can Boost Your Energy All Day Long', slug: 'morning-habits-energy-boost', metaDescription: 'Simple yet proven morning routines that can dramatically increase your daily energy levels and overall productivity.', content: '<p>Many people feel tired and sluggish throughout the day despite getting enough sleep. The key to sustained energy lies not only in sleep duration but also in what you do immediately after waking up. A well-structured morning routine can make a remarkable difference in how you feel for the rest of the day.</p><p>Drinking a glass of warm water first thing in the morning is the easiest step to start with. During sleep, your body loses significant fluid through breathing and perspiration. Rehydrating in the morning kickstarts your metabolism and helps all your organs return to optimal functioning.</p><p>In addition, spending just 5 to 10 minutes on light stretching is highly recommended. Stretching improves blood circulation, reduces muscle stiffness, and sends a signal to your brain that it is time to become active. Combined with 15 minutes of natural morning sunlight exposure, your circadian rhythm will regulate more effectively, leading to better sleep quality at night.</p>' },
  { category: 'Business', publishDate: '2025-01-08', author: 'Michael Chen', readTime: '5 min read', title: 'A Complete Guide to Building a Side Hustle in the Digital Age', slug: 'side-hustle-digital-age-guide', metaDescription: 'Practical steps to launch and grow a profitable side business using digital tools and platforms available today.', content: '<p>The concept of a side hustle has evolved dramatically in recent years. What once meant driving for a ride-share app or selling crafts on Etsy now encompasses a vast ecosystem of digital opportunities. From freelance consulting and content creation to software development and online courses, the options for generating additional income have never been more diverse.</p><p>The first step is identifying a skill that others are willing to pay for. This could be anything from graphic design and copywriting to data analysis or video editing. Platforms like Upwork, Fiverr, and Toptal make it easy to connect with potential clients worldwide. The key is to start small, build a portfolio, and gradually increase your rates as your reputation grows.</p><p>Consistency is what separates successful side hustlers from those who give up. Dedicate at least 10 to 15 hours per week to your side project, and treat it with the same professionalism you would apply to a full-time job. Many successful entrepreneurs started their businesses as side projects before scaling them into full-time ventures.</p>' },
  { category: 'Education', publishDate: '2025-01-03', author: 'Laura Thompson', readTime: '4 min read', title: 'Why Online Learning Continues to Grow and How to Make the Most of It', slug: 'online-learning-growth-2025', metaDescription: 'The online learning revolution is accelerating. Discover strategies to maximize your digital education experience.', content: '<p>The COVID-19 pandemic accelerated the adoption of online learning worldwide. Even as normalcy has returned, interest in digital education continues to climb. Research from the World Economic Forum shows that over 200 million people globally have enrolled in at least one online course since 2020, and the numbers keep growing.</p><p>The primary advantage of online learning is flexibility. You can study anytime and anywhere without needing to be physically present in a classroom. Platforms like Coursera, Khan Academy, and edX offer courses from top universities including Stanford, MIT, and Harvard, complete with video lectures, interactive exercises, and peer-reviewed assignments.</p><p>However, the biggest challenge in online learning is consistency and self-discipline. Without the rigid schedule of a traditional classroom, many people find it easy to procrastinate. The solution is to create a realistic study schedule, set clear learning objectives, and join online study communities to maintain mutual accountability and motivation.</p>' },
  { category: 'Lifestyle', publishDate: '2025-01-12', author: 'David Park', readTime: '3 min read', title: 'How to Maintain Focus in a Digital World Full of Distractions', slug: 'maintain-focus-digital-world', metaDescription: 'Practical tips for improving concentration and focus amid the constant digital distractions of modern life.', content: '<p>Have you ever picked up your phone to check a quick message, only to realize 30 minutes have passed and you are still scrolling through social media? This is an extremely common phenomenon in the digital age. The average person spends over 7 hours a day looking at screens, and a significant portion of that time is spent on unproductive activities.</p><p>One technique proven effective for improving focus is the Pomodoro method. The concept is simple: work for 25 minutes with complete focus, then take a 5-minute break. After four cycles, take a longer break of 15 to 30 minutes. This technique helps keep your brain fresh and prevents mental fatigue throughout the day.</p><p>In addition, try disabling non-essential notifications on your phone. Research shows it takes an average of 23 minutes to regain full focus after being distracted by a notification. By minimizing interruptions, your productivity can increase by up to 40%. Apps like Forest and Freedom can also help block distracting websites during work sessions.</p>' },
  { category: 'Travel', publishDate: '2025-01-16', author: 'Emma Rodriguez', readTime: '5 min read', title: 'Hidden Travel Destinations Around the World Worth Exploring', slug: 'hidden-travel-destinations-2025', metaDescription: 'Discover breathtaking travel destinations that remain off the beaten path and offer truly authentic experiences.', content: '<p>While millions of tourists flock to popular destinations like Paris, Bali, and Tokyo every year, some of the world\'s most spectacular places remain relatively undiscovered. These hidden gems offer pristine natural beauty, rich cultural experiences, and the kind of tranquility that crowded tourist hotspots simply cannot provide.</p><p>The Faroe Islands, located between Iceland and Norway, feature dramatic cliffs, emerald-green valleys, and a unique Nordic culture that feels untouched by mass tourism. With only about 53,000 residents and limited hotel capacity, the islands maintain an intimate, authentic atmosphere. Hiking trails wind through landscapes that look straight out of a fantasy novel.</p><p>For those who prefer warmer climates, the Azores archipelago in the middle of the Atlantic Ocean is a paradise of volcanic craters, natural hot springs, and lush green pastures. Often called the "Hawaii of Europe," these Portuguese islands offer world-class whale watching, diving, and hiking at a fraction of the cost of more famous destinations.</p>' },
  { category: 'Food', publishDate: '2025-01-20', author: 'Chef Andrea Rossi', readTime: '3 min read', title: 'Healthy Breakfast Recipes You Can Prepare in Under 5 Minutes', slug: 'healthy-breakfast-5-minutes', metaDescription: 'Quick and nutritious breakfast ideas for busy mornings that do not compromise on flavor or nutrition.', content: '<p>Breakfast is the most important meal of the day, yet many people skip it entirely due to morning rush. A healthy breakfast can significantly improve concentration, mood, and energy levels throughout the day. The good news is that several nutritious options can be prepared in just five minutes or less.</p><p>Overnight oats are one of the best choices available. Simply mix rolled oats with milk or yogurt, add fresh fruits like bananas or berries, and store in the refrigerator overnight. In the morning, your breakfast is ready to eat. You can also add honey, chia seeds, or nuts for extra protein and fiber to keep you full until lunchtime.</p><p>Another excellent option is a smoothie bowl. Blend frozen fruits like bananas, mangoes, and strawberries with a small amount of milk or coconut water. Pour into a bowl and top with granola, sliced fresh fruit, and a drizzle of honey. Not only is this nutritious, but it also looks beautiful and will motivate you to start your day right.</p>' },
  { category: 'Sports', publishDate: '2025-01-22', author: 'Coach Ryan Miller', readTime: '4 min read', title: 'The Science Behind High-Intensity Interval Training and Why It Works', slug: 'hiit-science-why-it-works', metaDescription: 'Understanding the physiological benefits of HIIT workouts and how they compare to traditional steady-state cardio.', content: '<p>High-Intensity Interval Training, commonly known as HIIT, has become one of the most popular workout methods worldwide. Unlike traditional steady-state cardio where you maintain a consistent pace for 30 to 60 minutes, HIIT alternates between short bursts of intense exercise and brief recovery periods, typically completing a full workout in 15 to 25 minutes.</p><p>The science behind HIIT is compelling. Research published in the Journal of Physiology shows that HIIT can increase your VO2 max by up to 15% in just a few weeks, compared to much smaller gains from steady-state cardio. This means your body becomes more efficient at using oxygen, which translates to better endurance in all physical activities.</p><p>Perhaps the most appealing benefit of HIIT is the afterburn effect, scientifically known as excess post-exercise oxygen consumption (EPOC). After a HIIT session, your body continues to burn calories at an elevated rate for up to 48 hours. This makes HIIT particularly effective for fat loss while also preserving muscle mass.</p>' },
  { category: 'Entertainment', publishDate: '2025-01-25', author: 'Rachel Kim', readTime: '4 min read', title: 'The Rise of Interactive Storytelling in Modern Gaming and Film', slug: 'interactive-storytelling-rise', metaDescription: 'How interactive narratives are blurring the lines between gaming and cinema, creating entirely new entertainment experiences.', content: '<p>Interactive storytelling has undergone a remarkable transformation in recent years. What began with simple choose-your-own-adventure books has evolved into sophisticated digital experiences that blur the lines between video games and traditional film. Titles like Baldur\'s Gate 3 and series like Black Mirror: Bandersnatch have demonstrated that audiences crave agency in their entertainment.</p><p>The technology driving this revolution includes advanced game engines like Unreal Engine 5, which can render photorealistic environments in real time, and AI-driven narrative systems that can adapt storylines based on player choices. Streaming platforms are also experimenting with interactive content, recognizing that younger audiences, in particular, prefer participatory over passive entertainment.</p><p>Industry analysts project that the interactive entertainment market will exceed $300 billion by 2027. This growth is fueled by advances in virtual reality, augmented reality, and cloud gaming, which make immersive interactive experiences accessible to a broader audience than ever before.</p>' },
  { category: 'Science', publishDate: '2025-02-01', author: 'Dr. Robert Chang', readTime: '5 min read', title: 'Breakthroughs in Quantum Computing That Could Change Everything', slug: 'quantum-computing-breakthroughs-2025', metaDescription: 'Recent advances in quantum computing are bringing us closer to practical applications that could revolutionize multiple industries.', content: '<p>Quantum computing has moved from theoretical physics into practical engineering at an unprecedented pace. In 2025, several major technology companies have achieved milestones that were considered impossible just five years ago. IBM, Google, and a handful of startups are now operating quantum processors with hundreds of qubits, bringing practical quantum advantage closer to reality.</p><p>One of the most promising applications is in drug discovery. Traditional drug development takes an average of 12 years and costs over $2 billion. Quantum computers can simulate molecular interactions with a level of accuracy that classical computers simply cannot match, potentially reducing drug discovery timelines to just a few years and saving pharmaceutical companies billions of dollars.</p><p>Another critical application lies in cryptography and cybersecurity. Quantum computers pose a significant threat to current encryption standards, which is why researchers are racing to develop quantum-resistant algorithms. The National Institute of Standards and Technology (NIST) has already standardized several post-quantum cryptographic algorithms to prepare for the quantum era.</p>' },
  { category: 'Business', publishDate: '2025-02-05', author: 'Amanda Foster', readTime: '5 min read', title: 'How Remote Work Is Reshaping Corporate Culture and Productivity', slug: 'remote-work-corporate-culture-2025', metaDescription: 'An in-depth look at how the shift to remote and hybrid work models is permanently changing the way companies operate.', content: '<p>Remote work has evolved from a temporary pandemic measure into a permanent fixture of the modern workplace. According to a 2025 survey by Buffer, over 60% of knowledge workers now work remotely at least part of the time, and 25% work fully remote. This shift has fundamentally altered how companies think about productivity, collaboration, and company culture.</p><p>Studies from Stanford University have shown that remote workers are, on average, 13% more productive than their office-based counterparts. However, this productivity gain comes with challenges. Communication silos, feelings of isolation, and difficulty in maintaining team cohesion are common issues that companies must actively address through intentional culture-building strategies.</p><p>The most successful remote companies invest heavily in digital infrastructure, regular virtual team-building activities, and clear asynchronous communication protocols. Tools like Notion, Slack, and Loom have become essential, but the real differentiator is a company culture that values outcomes over hours logged, trusts employees to manage their own time, and fosters genuine human connection despite physical distance.</p>' },
  { category: 'Health', publishDate: '2025-02-10', author: 'Dr. Lisa Nakamura', readTime: '4 min read', title: 'The Gut-Brain Connection: How Your Microbiome Affects Mental Health', slug: 'gut-brain-connection-mental-health', metaDescription: 'Emerging research reveals the surprising link between gut health and mental wellbeing, opening new treatment possibilities.', content: '<p>Scientists have long suspected a connection between the gut and the brain, but recent research has revealed just how profound this relationship truly is. Your gut contains over 100 trillion microorganisms collectively known as the microbiome, and these tiny organisms produce an estimated 90% of your body\'s serotonin, the neurotransmitter closely linked to mood regulation.</p><p>A landmark 2024 study published in Nature Neuroscience demonstrated that specific gut bacteria can directly influence anxiety and depression-like behaviors in mice. When researchers transplanted the microbiome from anxious mice into calm mice, the calm mice began exhibiting anxious behaviors. This finding has opened entirely new avenues for treating mental health conditions through dietary interventions.</p><p>Practical steps to support a healthy gut-brain axis include eating a diverse range of fiber-rich foods, incorporating fermented foods like yogurt, kimchi, and sauerkraut into your diet, and minimizing processed foods and artificial sweeteners. Prebiotic supplements and probiotic foods can also help maintain a balanced microbiome that supports both digestive and mental health.</p>' },
  { category: 'Technology', publishDate: '2025-02-15', author: 'Kevin Wright', readTime: '4 min read', title: 'Why Cybersecurity Should Be Every Individual\'s Priority in 2025', slug: 'cybersecurity-priority-2025', metaDescription: 'With cyber threats on the rise, understanding basic cybersecurity practices has never been more important for everyday users.', content: '<p>Cybercrime damages are projected to exceed $10 trillion globally by the end of 2025, making it the third-largest economy in the world if it were a country. Despite this alarming statistic, most individuals still practice poor digital hygiene. Weak passwords, reused credentials across multiple services, and clicking on suspicious links remain the most common ways hackers gain access to personal accounts.</p><p>The rise of AI-powered phishing attacks has made email scams more convincing than ever. Cybercriminals now use large language models to craft personalized emails that are nearly indistinguishable from legitimate communications. This means that traditional warning signs like poor grammar or generic greetings are no longer reliable indicators of fraudulent messages.</p><p>Protecting yourself does not require technical expertise. Using a password manager like Bitwarden or 1Password, enabling two-factor authentication on every account, keeping software updated, and taking a moment to verify unexpected requests before responding can eliminate the vast majority of cyber risks. Think of these practices as locking your front door — simple, routine, and highly effective.</p>' },
  { category: 'Education', publishDate: '2025-02-18', author: 'Prof. Diana Walsh', readTime: '4 min read', title: 'The Future of Higher Education: Trends Reshaping Universities', slug: 'future-higher-education-trends', metaDescription: 'How universities are adapting to changing student expectations, technology, and the evolving job market.', content: '<p>Higher education is undergoing its most significant transformation in centuries. Rising tuition costs, the growing demand for practical skills, and the availability of free or low-cost online alternatives are forcing universities to rethink their value proposition. Students and employers alike are questioning whether a traditional four-year degree is still the best path to a successful career.</p><p>Micro-credentials and digital badges are gaining traction as alternatives to full degrees. These focused, skill-specific programs take weeks rather than years to complete and allow learners to demonstrate competence in specific areas. Companies like Google, IBM, and Amazon now offer their own professional certificates that are recognized by employers worldwide.</p><p>Universities that thrive in this new landscape will be those that embrace flexibility, offer strong industry partnerships, and integrate real-world project-based learning into their curricula. The institutions that cling to rigid, lecture-based models risk becoming irrelevant as learners increasingly choose pathways that offer the best return on their educational investment.</p>' },
  { category: 'Travel', publishDate: '2025-02-22', author: 'Marco Bianchi', readTime: '4 min read', title: 'Sustainable Travel: How to Explore the World Without Harming It', slug: 'sustainable-travel-guide-2025', metaDescription: 'Responsible travel practices that minimize environmental impact while maximizing authentic cultural experiences.', content: '<p>Sustainable travel has moved from a niche concern to a mainstream movement. With tourism accounting for approximately 8% of global carbon emissions, travelers are increasingly seeking ways to explore the world without leaving a damaging footprint. The good news is that sustainable travel often leads to more authentic and rewarding experiences.</p><p>One of the most impactful choices you can make is selecting your transportation carefully. Flying is the most carbon-intensive form of travel, so consider alternatives like high-speed rail for medium-distance journeys. When flying is unavoidable, choose direct flights to reduce emissions from takeoffs and landings, and consider purchasing verified carbon offsets from reputable organizations.</p><p>Accommodation choices also matter significantly. Locally owned hotels, guesthouses, and eco-lodges keep tourism revenue within the community and typically have a much smaller environmental footprint than large international chain hotels. Eating at local restaurants, hiring local guides, and purchasing handmade souvenirs directly support the communities you visit.</p>' },
  { category: 'Food', publishDate: '2025-02-25', author: 'Natalie Green', readTime: '3 min read', title: 'The Plant-Based Movement: Myths, Facts, and Getting Started', slug: 'plant-based-movement-myths-facts', metaDescription: 'Separating fact from fiction in the plant-based diet trend and practical tips for transitioning to more plant-forward meals.', content: '<p>Plant-based diets have surged in popularity, with over 25% of Americans now actively reducing their meat consumption. Despite the growing mainstream acceptance, numerous myths and misconceptions persist about plant-based nutrition, leaving many people confused about whether this dietary approach is actually healthy and sustainable.</p><p>One common myth is that plant-based diets lack sufficient protein. In reality, legumes, tofu, tempeh, quinoa, and many other plant foods provide abundant protein. The key is eating a varied diet that includes different protein sources throughout the day. Athletes like tennis champion Venus Williams and Formula 1 driver Lewis Hamilton have thrived on plant-based diets for years.</p><p>Getting started does not require an overnight transformation. Begin by replacing one meal per day with a plant-based option, explore international cuisines that are naturally plant-forward like Indian, Thai, and Mediterranean, and experiment with new ingredients. Many people find that the transition is easier and more enjoyable than they expected.</p>' },
  { category: 'Sports', publishDate: '2025-02-28', author: 'Coach James Alvarez', readTime: '3 min read', title: 'Yoga for Beginners: Simple Poses You Can Practice Every Day', slug: 'yoga-beginners-daily-practice', metaDescription: 'A beginner-friendly guide to daily yoga practice with poses that improve flexibility, strength, and mental clarity.', content: '<p>Yoga has been practiced for thousands of years and continues to gain popularity worldwide. Many people are discovering that yoga offers benefits far beyond physical flexibility, including mental clarity, stress reduction, and improved sleep quality. The best part is that yoga can be practiced by anyone regardless of age or fitness level.</p><p>Several fundamental poses are perfect for beginners. Mountain Pose (Tadasana) teaches proper standing posture and body awareness. Downward-Facing Dog (Adho Mukha Svanasana) stretches the entire body while building upper body strength. Child\'s Pose (Balasana) is deeply relaxing and can be used as a resting position at any time during your practice.</p><p>To get started, all you need is a comfortable yoga mat. Search for beginner yoga routines on YouTube, where many qualified instructors offer free, high-quality classes. Dedicate 15 to 20 minutes each day to practice, and you will begin noticing improvements in flexibility, calmness, and sleep quality within just a few weeks.</p>' },
  { category: 'Entertainment', publishDate: '2025-03-01', author: 'Olivia Martinez', readTime: '4 min read', title: 'Best Independent Films of 2025 That Deserve Your Attention', slug: 'best-indie-films-2025', metaDescription: 'A curated selection of the most compelling independent films released in 2025 that showcase exceptional storytelling.', content: '<p>While blockbuster franchises continue to dominate the box office, independent cinema is experiencing a creative renaissance. Streaming platforms like A24, Neon, and Searchlight Pictures have made it easier than ever for thoughtfully crafted films to reach wide audiences. The best indie films of 2025 demonstrate that powerful storytelling does not require massive budgets.</p><p>Several standout films have captured critical acclaim this year. Directors from diverse backgrounds are bringing fresh perspectives to familiar genres, exploring themes of identity, migration, and human resilience with nuance and authenticity. These films remind us that cinema at its best is an art form capable of fostering deep empathy and understanding.</p><p>Supporting independent film is about more than entertainment — it is about sustaining a diverse creative ecosystem. By seeking out and watching indie films, audiences encourage studios to take creative risks and tell stories that might otherwise never be told. Film festivals like Sundance, Toronto, and South by Southwest remain the best places to discover tomorrow\'s classics.</p>' },
  { category: 'Science', publishDate: '2025-03-05', author: 'Dr. Emily Watson', readTime: '5 min read', title: 'CRISPR Gene Editing: Progress, Ethics, and the Future of Medicine', slug: 'crispr-gene-editing-future-medicine', metaDescription: 'An overview of the latest CRISPR advancements, the ethical debates surrounding gene editing, and its potential to cure diseases.', content: '<p>CRISPR-Cas9 gene editing technology continues to advance at a breathtaking pace. In 2025, the first CRISPR-based therapies for sickle cell disease and beta-thalassemia received full regulatory approval in multiple countries, marking a historic milestone in medicine. These treatments effectively cure genetic blood disorders that have affected millions of people worldwide for generations.</p><p>Beyond treating existing conditions, CRISPR is opening the door to preventing hereditary diseases before birth. Germline editing, which modifies the DNA of embryos, could theoretically eliminate genetic conditions like cystic fibrosis, Huntington\'s disease, and certain forms of cancer from family bloodlines. However, this capability raises profound ethical questions about the limits of human intervention in natural processes.</p><p>The scientific community is actively working to establish international guidelines for responsible gene editing. The key challenge is balancing the enormous potential to relieve human suffering with concerns about unintended consequences, equitable access to treatments, and the philosophical implications of modifying the human genome. Open public discourse will be essential as this technology continues to evolve.</p>' },
  { category: 'Lifestyle', publishDate: '2025-03-08', author: 'Sophia Turner', readTime: '4 min read', title: 'Mindfulness for Beginners: A Simple Guide to Reducing Stress', slug: 'mindfulness-beginners-stress-reduction', metaDescription: 'An accessible introduction to mindfulness meditation and practical techniques for managing daily stress.', content: '<p>Stress has become an inescapable part of modern life. Work pressure, social media anxiety, and information overload leave many people feeling overwhelmed. Mindfulness meditation is a scientifically validated method that can help manage stress, improve focus, and enhance overall well-being without requiring any special equipment or expensive training.</p><p>Starting a mindfulness practice is remarkably simple. Set aside 5 to 10 minutes each morning, find a quiet place to sit comfortably, close your eyes, and focus entirely on your breathing. When your mind wanders — which is completely normal — gently bring your attention back to the breath. The goal is not to empty your mind but to observe your thoughts without judgment.</p><p>Research has shown that just eight weeks of consistent mindfulness practice can produce significant benefits, including lower cortisol levels, improved sleep quality, enhanced immune function, and better emotional regulation. Apps like Headspace, Calm, and Insight Timer provide guided sessions for beginners, making it easy to develop a regular practice even with a busy schedule.</p>' },
];

// ─── Helpers ─────────────────────────────────────────────────────────
function getRandomArticle(): ArticleData {
  return ARTICLES[Math.floor(Math.random() * ARTICLES.length)];
}

function formatCreatedAt(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleString();
  } catch {
    return dateStr;
  }
}

function copyText(text: string, toast: (data: { title: string; description?: string; variant?: 'default' | 'destructive' }) => void) {
  navigator.clipboard.writeText(text).then(() => {
    toast({ title: 'Copied!', description: 'Link copied to clipboard' });
  }).catch(() => {
    toast({ title: 'Error', description: 'Failed to copy', variant: 'destructive' });
  });
}

function maskUrl(url: string): string {
  if (!url) return 'Not configured';
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.hostname}`;
  } catch {
    return url.slice(0, 30) + '...';
  }
}

// ─── Utility Functions ───────────────────────────────────────────────
function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol);
  } catch {
    return false;
  }
}

function sanitizeHtml(html: string): string {
  // Remove script tags and event handlers
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/\bon\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\bon\w+\s*=\s*'[^']*'/gi, '')
    .replace(/javascript\s*:/gi, '')
    .replace(/<iframe\b[^>]*>.*?<\/iframe>/gi, '')
    .replace(/<object\b[^>]*>.*?<\/object>/gi, '')
    .replace(/<embed\b[^>]*>/gi, '')
    .replace(/<form\b[^>]*>.*?<\/form>/gi, '');
}

// ─── PIN Verification ────────────────────────────────────────────────
async function verifyPin(pin: string): Promise<boolean> {
  try {
    const value = await getDb().getSetting('admin_pin');
    if (value) {
      return pin === value;
    }
  } catch {
    // Table/collection might not exist yet
  }
  // No default PIN — admin must set one via settings first time
  return false;
}

// ─── Icons (inline SVG components) ──────────────────────────────────
function IconLink({ className = 'w-6 h-6' }: { className?: string }) {
  return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>;
}
function IconPlus({ className = 'w-6 h-6' }: { className?: string }) {
  return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>;
}
function IconCog({ className = 'w-6 h-6' }: { className?: string }) {
  return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>;
}
function IconLock({ className = 'w-10 h-10' }: { className?: string }) {
  return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>;
}
function IconHome({ className = 'w-6 h-6' }: { className?: string }) {
  return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>;
}
function IconTrash({ className = 'w-5 h-5' }: { className?: string }) {
  return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>;
}
function IconCopy({ className = 'w-5 h-5' }: { className?: string }) {
  return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>;
}
function IconLogout({ className = 'w-5 h-5' }: { className?: string }) {
  return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>;
}
function IconChartBar({ className = 'w-6 h-6' }: { className?: string }) {
  return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>;
}
function IconSearch({ className = 'w-5 h-5' }: { className?: string }) {
  return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>;
}
function IconDownload({ className = 'w-5 h-5' }: { className?: string }) {
  return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>;
}
function IconQrCode({ className = 'w-5 h-5' }: { className?: string }) {
  return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 3h7v7H3V3zm11 0h7v7h-7V3zM3 14h7v7H3v-7zm14 3h.01" /><path strokeLinecap="round" strokeLinejoin="round" d="M14 14h3v3h-3v-3z" /><path strokeLinecap="round" strokeLinejoin="round" d="M14 20h.01M20 14h.01M20 20h.01" /></svg>;
}
function IconDatabase({ className = 'w-6 h-6' }: { className?: string }) {
  return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" /></svg>;
}
function IconFacebook({ className = 'w-6 h-6' }: { className?: string }) {
  return <svg className={className} viewBox="0 0 24 24" fill="currentColor"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" /></svg>;
}

function IconShield({ className = 'w-6 h-6' }: { className?: string }) {
  return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>;
}
function IconBack({ className = 'w-5 h-5' }: { className?: string }) {
  return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>;
}
function IconCheck({ className = 'w-3.5 h-3.5' }: { className?: string }) {
  return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>;
}
function IconKey({ className = 'w-5 h-5' }: { className?: string }) {
  return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" /></svg>;
}
function IconGithub({ className = 'w-5 h-5' }: { className?: string }) {
  return <svg className={className} viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z"/></svg>;
}
function IconGlobe({ className = 'w-6 h-6' }: { className?: string }) {
  return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" /></svg>;
}
function IconPlug({ className = 'w-5 h-5' }: { className?: string }) {
  return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>;
}
function IconBook({ className = 'w-6 h-6' }: { className?: string }) {
  return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" /></svg>;
}
function IconPalette({ className = 'w-6 h-6' }: { className?: string }) {
  return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" /></svg>;
}

function WhatsAppIcon({ className = 'w-6 h-6' }: { className?: string }) {
  return <svg className={className} viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" /></svg>;
}

// ─── Toggle Switch ──────────────────────────────────────────────────
function Toggle({ enabled, onChange }: { enabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      onClick={() => onChange(!enabled)}
      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900 ${
        enabled ? 'bg-emerald-500' : 'bg-gray-700'
      }`}
    >
      <span
        className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-lg ring-0 transition-transform duration-200 ease-in-out ${
          enabled ? 'translate-x-5' : 'translate-x-0'
        }`}
      />
    </button>
  );
}

// ─── PIN Login ───────────────────────────────────────────────────────
function PinLogin({ onLogin, toast }: { onLogin: () => void; toast: ReturnType<typeof useToast>['toast'] }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [loginAttempts, setLoginAttempts] = useState(0);
  const [lockedUntil, setLockedUntil] = useState(0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Rate limiting: max 5 attempts, then lock for 60 seconds
    const now = Date.now();
    if (lockedUntil && now < lockedUntil) {
      const remaining = Math.ceil((lockedUntil - now) / 1000);
      setError(`Too many attempts. Try again in ${remaining}s`);
      return;
    }

    setLoading(true);
    setError('');
    const valid = await verifyPin(pin);
    if (valid) {
      localStorage.setItem('safelink_auth', btoa(`safelink:${Date.now()}`));
      toast({ title: 'Welcome!', description: 'Logged in successfully' });
      onLogin();
    } else {
      const newAttempts = loginAttempts + 1;
      setLoginAttempts(newAttempts);
      if (newAttempts >= 5) {
        setLockedUntil(now + 60000); // Lock for 60 seconds
        setError('Too many attempts. Locked for 60 seconds.');
        setLoginAttempts(0);
      } else {
        setError(`Wrong PIN (${5 - newAttempts} attempts remaining)`);
      }
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gray-950">
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-emerald-600/5 rounded-full blur-3xl" />
      </div>
      <div className="w-full max-w-md relative">
        <div className="bg-gray-900/80 backdrop-blur-xl rounded-2xl p-8 border border-gray-800 shadow-2xl shadow-black/50">
          <div className="flex flex-col items-center mb-8">
            <div className="w-14 h-14 bg-emerald-500/20 rounded-2xl flex items-center justify-center mb-4 ring-1 ring-emerald-500/30">
              <span className="text-emerald-400"><IconLock className="w-7 h-7" /></span>
            </div>
            <h1 className="text-xl font-bold text-white">SafeLink</h1>
            <p className="text-gray-500 text-xs mt-1.5">Enter PIN to continue</p>
          </div>
          <form onSubmit={handleSubmit} className="space-y-4">
            <input
              type="password"
              value={pin}
              onChange={(e) => { setPin(e.target.value); setError(''); }}
              placeholder="Enter PIN"
              autoFocus
              inputMode="numeric"
              maxLength={10}
              className="w-full px-4 py-3.5 bg-gray-800/80 border border-gray-700 rounded-xl text-white text-center text-lg tracking-[0.3em] placeholder-gray-600 placeholder:text-sm placeholder:tracking-normal focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all"
            />
            {error && <p className="text-red-400 text-xs text-center">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3.5 bg-emerald-500 hover:bg-emerald-600 active:bg-emerald-700 disabled:opacity-50 text-white font-semibold text-sm rounded-xl transition-colors cursor-pointer shadow-lg shadow-emerald-500/20"
            >
              {loading ? 'Verifying...' : 'Unlock'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

// ─── Redirect Page ───────────────────────────────────────────────────
function RedirectPage({ code, toast }: { code: string; toast: ReturnType<typeof useToast>['toast'] }) {
  const [link, setLink] = useState<ShortLinkData | null>(null);
  const [loading, setLoading] = useState(true);
  const [seconds, setSeconds] = useState(0);
  const [redirectTime, setRedirectTime] = useState(5);
  const [waShow, setWaShow] = useState(false);
  const [fbShow, setFbShow] = useState(false);
  const [waUrl, setWaUrl] = useState('');
  const [fbUrl, setFbUrl] = useState('');
  const [footerUrl, setFooterUrl] = useState('');
  const [fallbackUrl, setFallbackUrl] = useState('');
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [linkLoaded, setLinkLoaded] = useState(false);
  const [article] = useState<ArticleData>(getRandomArticle);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Set Facebook-safe meta tags for redirect page
  useEffect(() => {
    const setMeta = (attr: string, key: string, content: string) => {
      let el = document.querySelector(`meta[${attr}="${key}"]`) as HTMLMetaElement;
      if (!el) {
        el = document.createElement('meta');
        el.setAttribute(attr, key);
        document.head.appendChild(el);
      }
      el.content = content;
    };
    const removeMeta = (attr: string, key: string) => {
      const el = document.querySelector(`meta[${attr}="${key}"]`);
      if (el) el.remove();
    };

    setMeta('name', 'robots', 'index, follow');

    const siteName = document.title || 'SafeLink';
    const pageUrl = window.location.href;
    setMeta('property', 'og:title', article.title);
    setMeta('property', 'og:description', article.metaDescription);
    setMeta('property', 'og:type', 'article');
    setMeta('property', 'og:url', pageUrl);
    document.title = `${article.title} — ${siteName}`;

    // Canonical URL
    let canonical = document.querySelector('link[rel="canonical"]') as HTMLLinkElement;
    if (!canonical) {
      canonical = document.createElement('link');
      canonical.setAttribute('rel', 'canonical');
      document.head.appendChild(canonical);
    }
    canonical.href = pageUrl;

    // JSON-LD structured data
    const existingScript = document.getElementById('safelink-jsonld');
    if (existingScript) existingScript.remove();

    const jsonLd = {
      "@context": "https://schema.org",
      "@type": "Article",
      "headline": article.title,
      "description": article.metaDescription,
      "author": { "@type": "Person", "name": article.author },
      "publisher": { "@type": "Organization", "name": siteName },
      "datePublished": article.publishDate,
      "mainEntityOfPage": pageUrl,
    };
    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.id = 'safelink-jsonld';
    script.textContent = JSON.stringify(jsonLd);
    document.head.appendChild(script);

    return () => {
      removeMeta('name', 'robots');
      removeMeta('property', 'og:type');
      canonical?.remove();
      document.getElementById('safelink-jsonld')?.remove();
    };
  }, [article]);

  // Fetch settings from database
  useEffect(() => {
    async function loadSettings() {
      let settingsData: SettingRow[] = [];
      try {
        const data = await getDb().getAllSettings();
        if (data) {
          settingsData = data;
          data.forEach((row: SettingRow) => {
            switch (row.key) {
              case 'redirect_time': setRedirectTime(parseInt(row.value) || 5); break;
              case 'wa_channel_show': setWaShow(row.value === 'true'); break;
              case 'wa_channel_url': setWaUrl(row.value || ''); break;
              case 'fb_group_show': setFbShow(row.value === 'true'); break;
              case 'fb_group_url': setFbUrl(row.value || ''); break;
              case 'footer_url': setFooterUrl(row.value || ''); break;
              case 'fallback_url': setFallbackUrl(row.value || ''); break;
            }
          });
        }
      } catch { /* use defaults */ }
      setSettingsLoaded(true);

      // ─── Auto-cleanup: run once per day ──────────────────────────
      try {
        const lastCleanup = localStorage.getItem('safelink_last_cleanup');
        const today = new Date().toDateString();
        if (lastCleanup !== today) {
          const daysRaw = settingsData.find((r: SettingRow) => r.key === 'auto_delete_days');
          const modeRaw = settingsData.find((r: SettingRow) => r.key === 'auto_delete_mode');
          const days = daysRaw ? parseInt(daysRaw.value) || 0 : 0;
          const mode = modeRaw?.value || 'age';

          if (days > 0) {
            if (mode === 'inactive') {
              // Delete links with 0 clicks older than N days
              getDb().getAllLinks().then(links => {
                const cutoff = new Date(Date.now() - days * 86400000).getTime();
                const toDelete = links.filter(l => l.clicks === 0 && new Date(l.created_at).getTime() < cutoff);
                Promise.all(toDelete.map(l => getDb().deleteLink(l.code))).then(() => {
                  if (toDelete.length > 0) console.log(`[SafeLink] Auto-cleanup: removed ${toDelete.length} inactive link(s)`);
                  localStorage.setItem('safelink_last_cleanup', today);
                }).catch(() => {});
              }).catch(() => {});
            } else {
              // Delete ALL links older than N days
              getDb().cleanupOldLinks(days).then(res => {
                if (res.deleted > 0) console.log(`[SafeLink] Auto-cleanup: removed ${res.deleted} link(s) older than ${days} days`);
                localStorage.setItem('safelink_last_cleanup', today);
              }).catch(() => {});
            }
          }
        }
      } catch { /* silent */ }
    }
    loadSettings();
  }, []);

  // Fetch the short link (wait for settings so fallback URL is available)
  useEffect(() => {
    if (!settingsLoaded) return; // Don't fetch until settings are loaded
    async function fetchLink() {
      try {
        const found = await getDb().getLinkByCode(code);
        if (found) {
          setLink(found);
          await getDb().incrementClicks(code);
        } else {
          // Link not found — try fallback URL from settings
          if (fallbackUrl && isValidUrl(fallbackUrl)) {
            window.location.href = fallbackUrl;
            return;
          }
          toast({ title: 'Not Found', description: 'Link not found', variant: 'destructive' });
        }
      } catch (err) {
        // DB error — try fallback URL
        if (fallbackUrl && isValidUrl(fallbackUrl)) {
          window.location.href = fallbackUrl;
          return;
        }
        toast({ title: 'Error', description: String(err), variant: 'destructive' });
      }
      setLinkLoaded(true);
    }
    fetchLink();
  }, [code, toast, settingsLoaded, fallbackUrl]);

  // Only start countdown when BOTH link and settings are loaded
  useEffect(() => {
    if (link && seconds === 0 && settingsLoaded && linkLoaded) {
      setSeconds(redirectTime);
    }
  }, [link, redirectTime, seconds, settingsLoaded, linkLoaded]);

  useEffect(() => {
    if (seconds > 0 && link) {
      timerRef.current = setInterval(() => {
        setSeconds((prev) => {
          if (prev <= 1) {
            if (timerRef.current) clearInterval(timerRef.current);
            if (isValidUrl(link.url)) {
              window.location.href = link.url;
            } else {
              toast({ title: 'Invalid URL', description: 'The redirect URL is not valid', variant: 'destructive' });
            }
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
      return () => { if (timerRef.current) clearInterval(timerRef.current); };
    }
  }, [seconds, link]);

  const allLoaded = settingsLoaded && linkLoaded;

  const hasCta = (waShow && waUrl) || (fbShow && fbUrl);

  if (!allLoaded) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-950">
        <div className="w-16 h-16 border-4 border-gray-700 border-t-emerald-500 rounded-full animate-spin" />
      </div>
    );
  }

  if (!link) {
    // If fallback URL is set, redirect immediately
    if (fallbackUrl && isValidUrl(fallbackUrl)) {
      window.location.href = fallbackUrl;
      return null;
    }
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-gray-950">
        <div className="text-center bg-gray-900 rounded-2xl p-10 border border-gray-800 max-w-md">
          <div className="w-[4.5rem] h-[4.5rem] bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-5">
            <svg className="w-10 h-10 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </div>
          <h2 className="text-xl font-bold text-white mb-3">Link Not Found</h2>
          <p className="text-gray-500 text-base">The shortlink does not exist or has been removed.</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`min-h-screen bg-gray-950 ${hasCta ? 'pb-36' : 'pb-8'}`}>
      <div className="max-w-3xl mx-auto p-5 pt-8">
        <div className="bg-gray-900 rounded-2xl border border-gray-800 overflow-hidden">
          <div className="p-5 sm:p-6 pb-0">
            <div className="flex flex-wrap items-center gap-2.5 text-xs text-gray-500 mb-3">
              <span className="bg-emerald-500/10 text-emerald-400 px-3 py-1 rounded-full font-semibold">{article.category.toUpperCase()}</span>
              <span>{article.publishDate}</span>
              <span className="text-gray-700">|</span>
              <span>{article.author}</span>
              <span className="text-gray-700">|</span>
              <span>{article.readTime}</span>
            </div>
            <h1 className="text-lg sm:text-2xl font-bold text-white leading-tight">{article.title}</h1>
          </div>
          <img src={`https://picsum.photos/800/400?${Date.now()}`} alt="Article" className="w-full mt-4" loading="eager" />
          <div className="p-5 sm:p-6">
            <p className="text-gray-400 text-sm sm:text-base italic mb-4">{article.metaDescription}</p>
            <div className="text-gray-300 text-base leading-relaxed space-y-4" dangerouslySetInnerHTML={{ __html: sanitizeHtml(article.content) }} />
          </div>
        </div>
        <div className="mt-6 text-center">
          <div className="inline-flex items-center gap-4 bg-gray-900 rounded-2xl px-8 py-5 border border-gray-800">
            <div className="w-12 h-12 border-3 border-gray-700 border-t-emerald-500 rounded-full animate-spin" style={{ borderWidth: '3px' }} />
            <div className="text-left">
              <p className="text-white text-base font-medium">Redirect in <span className="text-emerald-400 font-bold text-2xl ml-1">{seconds}</span></p>
              <p className="text-gray-600 text-sm truncate max-w-xs sm:max-w-sm">{link.url}</p>
            </div>
          </div>
        </div>
      </div>
      {hasCta && (
        <div className="fixed bottom-0 left-0 right-0 z-50 p-4 bg-gray-950/90 backdrop-blur-xl border-t border-gray-800">
          <div className="max-w-3xl mx-auto flex gap-3">
            {waShow && waUrl && isValidUrl(waUrl) && (
              <a href={waUrl} target="_blank" rel="noopener noreferrer" className="flex-1 flex items-center justify-center gap-2.5 py-4 bg-emerald-500 hover:bg-emerald-600 active:bg-emerald-700 text-white text-sm font-semibold rounded-xl transition-colors shadow-lg shadow-emerald-500/20">
                <WhatsAppIcon className="w-5 h-5" /> Join WhatsApp
              </a>
            )}
            {fbShow && fbUrl && isValidUrl(fbUrl) && (
              <a href={fbUrl} target="_blank" rel="noopener noreferrer" className="flex-1 flex items-center justify-center gap-2.5 py-4 bg-[#1877F2] hover:bg-[#166FE5] active:bg-[#1467D6] text-white text-sm font-semibold rounded-xl transition-colors shadow-lg shadow-[#1877F2]/20">
                <IconFacebook className="w-5 h-5" /> Join Facebook Group
              </a>
            )}
          </div>
        </div>
      )}
      <footer className={`text-center py-4 ${hasCta ? 'pb-28' : ''}`}>
        <a href={(footerUrl && isValidUrl(footerUrl)) ? footerUrl : '#'} target={(footerUrl && isValidUrl(footerUrl)) ? '_blank' : undefined} rel="noopener noreferrer" className="text-xs text-gray-600 hover:text-gray-400 transition-colors">Powered by SafeLink</a>
      </footer>
    </div>
  );
}

// ─── Click Log Stats Component ─────────────────────────────────────
function ClickLogStats() {
  const [logs, setLogs] = useState<ClickLogData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const data = await getDb().getClickLogs(1000);
        setLogs(data);
      } catch { /* silent */ }
      setLoading(false);
    }
    load();
  }, []);

  if (loading) {
    return <div className="text-center py-4 text-xs text-gray-600">Loading visitor data...</div>;
  }

  if (logs.length === 0) {
    return <div className="text-center py-6 text-xs text-gray-600">No visitor data yet. Click logs will appear here after links are visited.</div>;
  }

  // Aggregate stats
  const deviceCounts: Record<string, number> = {};
  const browserCounts: Record<string, number> = {};
  const osCounts: Record<string, number> = {};
  for (const log of logs) {
    deviceCounts[log.device] = (deviceCounts[log.device] || 0) + 1;
    browserCounts[log.browser] = (browserCounts[log.browser] || 0) + 1;
    osCounts[log.os] = (osCounts[log.os] || 0) + 1;
  }

  const total = logs.length;
  const sortedDevices = Object.entries(deviceCounts).sort((a, b) => b[1] - a[1]);
  const sortedBrowsers = Object.entries(browserCounts).sort((a, b) => b[1] - a[1]);
  const sortedOs = Object.entries(osCounts).sort((a, b) => b[1] - a[1]);

  const deviceIcons: Record<string, string> = {
    Mobile: '📱', Desktop: '💻', Tablet: '📟', Unknown: '❓',
  };
  const browserIcons: Record<string, string> = {
    Chrome: '🌐', Firefox: '🦊', Safari: '🧭', Edge: '🔵', Opera: '🔴', IE: '🔶', Other: '❓',
  };
  const osIcons: Record<string, string> = {
    Windows: '🪟', Android: '🤖', iOS: '🍎', macOS: '💻', Linux: '🐧', ChromeOS: '💫', Other: '❓',
  };

  function StatBar({ items, icons, total }: { items: [string, number][]; icons: Record<string, string>; total: number }) {
    return (
      <div className="space-y-2">
        {items.map(([name, count]) => {
          const pct = total > 0 ? Math.round((count / total) * 100) : 0;
          return (
            <div key={name} className="flex items-center gap-3">
              <span className="text-base w-6 text-center">{icons[name] || '❓'}</span>
              <span className="text-xs text-gray-400 w-16 shrink-0">{name}</span>
              <div className="flex-1 h-5 bg-gray-800 rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-emerald-500/60 to-emerald-400/60 rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
              </div>
              <span className="text-xs text-white font-medium w-10 text-right">{pct}%</span>
              <span className="text-xs text-gray-500 w-14 text-right">{count.toLocaleString()}</span>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      <div>
        <div className="text-xs text-gray-500 font-semibold uppercase tracking-wider mb-3">Device</div>
        <StatBar items={sortedDevices} icons={deviceIcons} total={total} />
      </div>
      <div>
        <div className="text-xs text-gray-500 font-semibold uppercase tracking-wider mb-3">Browser</div>
        <StatBar items={sortedBrowsers} icons={browserIcons} total={total} />
      </div>
      <div>
        <div className="text-xs text-gray-500 font-semibold uppercase tracking-wider mb-3">Operating System</div>
        <StatBar items={sortedOs} icons={osIcons} total={total} />
      </div>
    </div>
  );
}

// ─── Home Tab ────────────────────────────────────────────────────────
function HomeTab({ links, onLoad, toast, customDomain, customDomains, randomDomain }: { links: ShortLinkData[]; onLoad: () => void; toast: ReturnType<typeof useToast>['toast']; customDomain?: string; customDomains?: string; randomDomain?: boolean }) {
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'clicks'>('newest');

  // Ensure clicks is always treated as a number (fixes string concatenation bug from some DB adapters)
  const safeLinks = links.map(l => ({ ...l, clicks: Number(l.clicks) || 0 }));
  const totalLinks = safeLinks.length;
  const totalClicks = safeLinks.reduce((s, l) => s + l.clicks, 0);
  const avgClicks = totalLinks > 0 ? Math.round(totalClicks / totalLinks) : 0;

  // ─── Enhanced Statistics (Histats-like) ─────────────────────────────
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - now.getDay());
  startOfWeek.setHours(0, 0, 0, 0);
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const todayLinks = safeLinks.filter(l => l.created_at && l.created_at.slice(0, 10) === todayStr).length;
  const todayClicks = safeLinks.filter(l => l.created_at && l.created_at.slice(0, 10) === todayStr).reduce((s, l) => s + l.clicks, 0);
  const weekLinks = safeLinks.filter(l => l.created_at && new Date(l.created_at) >= startOfWeek).length;
  const weekClicks = safeLinks.filter(l => l.created_at && new Date(l.created_at) >= startOfWeek).reduce((s, l) => s + l.clicks, 0);
  const monthLinks = safeLinks.filter(l => l.created_at && new Date(l.created_at) >= startOfMonth).length;
  const monthClicks = safeLinks.filter(l => l.created_at && new Date(l.created_at) >= startOfMonth).reduce((s, l) => s + l.clicks, 0);
  const activeLinks = safeLinks.filter(l => l.clicks > 0).length;
  const zeroClickLinks = safeLinks.filter(l => l.clicks === 0).length;
  const uniqueDomains = new Set(safeLinks.map(l => { try { return new URL(l.url).hostname; } catch { return l.url; } })).size;
  const topClicks = safeLinks.length > 0 ? Math.max(...safeLinks.map(l => l.clicks)) : 0;
  const topLink = safeLinks.length > 0 ? safeLinks.reduce((a, b) => a.clicks >= b.clicks ? a : b) : null;

  const filteredLinks = useMemo(() => {
    let filtered = safeLinks;
    if (search.trim()) {
      const q = search.toLowerCase();
      filtered = filtered.filter((l) => l.code.toLowerCase().includes(q) || l.url.toLowerCase().includes(q));
    }
    switch (sortBy) {
      case 'newest': return [...filtered].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      case 'oldest': return [...filtered].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      case 'clicks': return [...filtered].sort((a, b) => b.clicks - a.clicks);
      default: return filtered;
    }
  }, [safeLinks, search, sortBy]);

  async function handleDelete(code: string) {
    try {
      const result = await getDb().deleteLink(code);
      if (result.success) { toast({ title: 'Deleted' }); onLoad(); }
      else { toast({ title: 'Error', description: result.error, variant: 'destructive' }); }
    } catch (err) { toast({ title: 'Error', description: String(err), variant: 'destructive' }); }
  }

  async function handleClearAll() {
    if (!confirm('Delete all links?')) return;
    try {
      const result = await getDb().clearAllLinks();
      if (result.success) { toast({ title: 'Cleared' }); onLoad(); }
      else { toast({ title: 'Error', description: result.error, variant: 'destructive' }); }
    } catch (err) { toast({ title: 'Error', description: String(err), variant: 'destructive' }); }
  }

  function handleExport() {
    if (links.length === 0) { toast({ title: 'No links to export', variant: 'destructive' }); return; }
    const csv = 'Code,URL,Clicks,Created At\n' + safeLinks.map(l => `"${l.code}","${l.url}",${l.clicks},"${formatCreatedAt(l.created_at)}"`).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `safelinks-export-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url);
    toast({ title: 'Exported!', description: `${links.length} links exported as CSV` });
  }

  return (
    <div className="space-y-6">
      {/* ─── Quick Stats Row ────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-6">
        {[
          { label: 'Total Links', value: totalLinks.toLocaleString(), icon: <IconLink className="w-5 h-5" />, color: 'emerald' as const },
          { label: 'Total Clicks', value: totalClicks.toLocaleString(), icon: <IconChartBar className="w-5 h-5" />, color: 'blue' as const },
          { label: 'Avg. Clicks/Link', value: avgClicks.toLocaleString(), icon: <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M16 8v8m-4-5v5m-4-2v2m-2 4h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>, color: 'purple' as const },
          { label: 'Top Clicks', value: topClicks.toLocaleString(), icon: <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>, color: 'amber' as const },
        ].map(stat => (
          <div key={stat.label} className="bg-gray-900 rounded-2xl p-4 border border-gray-800 hover:border-gray-700 transition-colors">
            <div className="flex items-center justify-between mb-2">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${stat.color === 'emerald' ? 'bg-emerald-500/10' : stat.color === 'blue' ? 'bg-blue-500/10' : stat.color === 'purple' ? 'bg-purple-500/10' : 'bg-amber-500/10'}`}>
                <span className={stat.color === 'emerald' ? 'text-emerald-400' : stat.color === 'blue' ? 'text-blue-400' : stat.color === 'purple' ? 'text-purple-400' : 'text-amber-400'}>{stat.icon}</span>
              </div>
              <svg className="w-4 h-4 text-gray-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" /></svg>
            </div>
            <div className="text-2xl font-bold text-white">{stat.value}</div>
            <div className="text-sm text-gray-500 mt-1">{stat.label}</div>
          </div>
        ))}
      </div>

      {/* ─── Detailed Statistics (Histats-like) ─────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="bg-gray-900/60 rounded-xl p-3.5 border border-gray-800/60">
          <div className="text-xs text-gray-500 mb-1">Today</div>
          <div className="text-lg font-bold text-white">{todayLinks} <span className="text-xs text-gray-500 font-normal">links</span></div>
          <div className="text-xs text-emerald-400 mt-0.5">{todayClicks.toLocaleString()} clicks</div>
        </div>
        <div className="bg-gray-900/60 rounded-xl p-3.5 border border-gray-800/60">
          <div className="text-xs text-gray-500 mb-1">This Week</div>
          <div className="text-lg font-bold text-white">{weekLinks} <span className="text-xs text-gray-500 font-normal">links</span></div>
          <div className="text-xs text-blue-400 mt-0.5">{weekClicks.toLocaleString()} clicks</div>
        </div>
        <div className="bg-gray-900/60 rounded-xl p-3.5 border border-gray-800/60">
          <div className="text-xs text-gray-500 mb-1">This Month</div>
          <div className="text-lg font-bold text-white">{monthLinks} <span className="text-xs text-gray-500 font-normal">links</span></div>
          <div className="text-xs text-purple-400 mt-0.5">{monthClicks.toLocaleString()} clicks</div>
        </div>
        <div className="bg-gray-900/60 rounded-xl p-3.5 border border-gray-800/60">
          <div className="text-xs text-gray-500 mb-1">Active Links</div>
          <div className="text-lg font-bold text-emerald-400">{activeLinks}</div>
          <div className="text-xs text-gray-600 mt-0.5">clicks &gt; 0</div>
        </div>
        <div className="bg-gray-900/60 rounded-xl p-3.5 border border-gray-800/60">
          <div className="text-xs text-gray-500 mb-1">Zero Clicks</div>
          <div className="text-lg font-bold text-red-400">{zeroClickLinks}</div>
          <div className="text-xs text-gray-600 mt-0.5">no traffic yet</div>
        </div>
        <div className="bg-gray-900/60 rounded-xl p-3.5 border border-gray-800/60">
          <div className="text-xs text-gray-500 mb-1">Unique Domains</div>
          <div className="text-lg font-bold text-amber-400">{uniqueDomains}</div>
          <div className="text-xs text-gray-600 mt-0.5">target URLs</div>
        </div>
      </div>

      {/* ─── Top Link Highlight ─────────────────────────────────────── */}
      {topLink && topLink.clicks > 0 && (
        <div className="bg-gradient-to-r from-emerald-500/10 to-blue-500/10 rounded-2xl p-4 border border-emerald-500/20">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-emerald-500/20 rounded-xl flex items-center justify-center flex-shrink-0">
              <svg className="w-5 h-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" /></svg>
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs text-gray-400 mb-0.5">Most Popular Link</div>
              <div className="text-sm font-mono text-emerald-400 truncate">{getDomain(customDomain, customDomains, randomDomain)}{topLink.code}</div>
              <div className="text-xs text-gray-500 truncate mt-0.5" title={topLink.url}>{topLink.url}</div>
            </div>
            <div className="text-right flex-shrink-0">
              <div className="text-2xl font-bold text-emerald-400">{topLink.clicks.toLocaleString()}</div>
              <div className="text-xs text-gray-500">clicks</div>
            </div>
          </div>
        </div>
      )}

      {/* ─── Device / Browser / OS Statistics ──────────────────────── */}
      <div className="bg-gray-900 rounded-2xl border border-gray-800 p-5">
        <h2 className="text-sm font-bold text-white flex items-center gap-2 mb-4">
          <svg className="w-4 h-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
          Visitor Statistics
        </h2>
        <ClickLogStats />
      </div>

      <div className="bg-gray-900 rounded-2xl border border-gray-800">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 px-5 pt-5 pb-3">
          <h2 className="text-sm font-bold text-white flex items-center gap-2">
            <IconDatabase className="w-4 h-4" /> Link History
            <span className="text-xs bg-gray-800 text-gray-400 px-2.5 py-1 rounded-full">{filteredLinks.length}</span>
          </h2>
          <div className="flex gap-2">
            {links.length > 0 && (
              <button onClick={handleExport} className="px-3 py-2 bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white text-xs font-medium rounded-lg transition-colors cursor-pointer flex items-center gap-1.5">
                <IconDownload className="w-3.5 h-3.5" /> Export
              </button>
            )}
            {links.length > 0 && (
              <button onClick={handleClearAll} className="px-3 py-2 bg-gray-800 hover:bg-red-500/20 text-gray-400 hover:text-red-400 text-xs font-medium rounded-lg transition-colors cursor-pointer flex items-center gap-1.5">
                <IconTrash className="w-3.5 h-3.5" /> Clear All
              </button>
            )}
          </div>
        </div>
        <div className="px-6 pb-4">
          <div className="flex gap-2">
            <div className="flex-1 relative">
              <IconSearch className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-600" />
              <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search links..." className="w-full pl-9 pr-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent" />
            </div>
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value as 'newest' | 'oldest' | 'clicks')} className="px-3 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 cursor-pointer">
              <option value="newest">Newest</option>
              <option value="oldest">Oldest</option>
              <option value="clicks">Most Clicks</option>
            </select>
          </div>
        </div>
        {filteredLinks.length === 0 ? (
          <div className="px-6 pb-8 pt-2 text-center">
            <div className="w-16 h-16 bg-gray-800 rounded-2xl flex items-center justify-center mx-auto mb-4"><IconLink className="w-8 h-8 text-gray-700" /></div>
            <p className="text-gray-600 text-sm">{search ? 'No links match your search' : 'No links yet. Create your first shortlink!'}</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-800/50 max-h-[500px] overflow-y-auto px-6 pb-2">
            {filteredLinks.map(l => (
              <div key={l.code} className="py-3 group">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <code className="text-emerald-400 text-sm font-mono font-semibold shrink-0">{getDomain(customDomain, customDomains, randomDomain)}{l.code}</code>
                    </div>
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-xs text-gray-700 shrink-0">&rarr;</span>
                      <span className="text-gray-500 text-sm truncate">{l.url}</span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-gray-600">
                      <span>{l.clicks} clicks</span>
                      <span>{formatCreatedAt(l.created_at)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                    <button onClick={() => copyText(getDomain(customDomain, customDomains, randomDomain) + l.code, toast)} className="p-2 hover:bg-gray-800 rounded-lg transition-colors cursor-pointer text-gray-500 hover:text-white" title="Copy short link">
                      <IconCopy className="w-4 h-4" />
                    </button>
                    <button onClick={() => { window.open(`https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(getDomain(customDomain, customDomains, randomDomain) + l.code)}`, '_blank'); }} className="p-2 hover:bg-gray-800 rounded-lg transition-colors cursor-pointer text-gray-500 hover:text-white" title="QR Code">
                      <IconQrCode className="w-4 h-4" />
                    </button>
                    <button onClick={() => handleDelete(l.code)} className="p-2 hover:bg-red-500/20 rounded-lg transition-colors cursor-pointer text-gray-500 hover:text-red-400" title="Delete">
                      <IconTrash className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Create Tab ──────────────────────────────────────────────────────
function CreateTab({ onLoad, toast, customDomain, customDomains, randomDomain }: { onLoad: () => void; toast: ReturnType<typeof useToast>['toast']; customDomain?: string; customDomains?: string; randomDomain?: boolean }) {
  const [mode, setMode] = useState<'single' | 'bulk'>('single');
  const [urlInput, setUrlInput] = useState('');
  const [bulkInput, setBulkInput] = useState('');
  const [results, setResults] = useState<ShortLinkData[]>([]);
  const [loading, setLoading] = useState(false);

  async function handleGenerate() {
    const url = urlInput.trim();
    if (!url) { toast({ title: 'Enter a URL', variant: 'destructive' }); return; }
    setLoading(true);
    try {
      const normalizedUrl = /^https?:\/\//i.test(url) ? url : `https://${url}`;
      let code = '';
      let unique = false;
      for (let attempt = 0; attempt < 10; attempt++) {
        code = Math.random().toString(36).substring(2, 7);
        const isUnique = await getDb().isCodeUnique(code);
        if (isUnique) { unique = true; break; }
      }
      if (unique) {
        const data = await getDb().createLink(code, normalizedUrl);
        setResults([data]);
        setUrlInput('');
        toast({ title: 'Created!' });
        onLoad();
      } else {
        toast({ title: 'Error', description: 'Failed to generate unique code', variant: 'destructive' });
      }
    } catch (err) {
      toast({ title: 'Failed to create link', description: String(err), variant: 'destructive' });
    } finally { setLoading(false); }
  }

  async function handleBulk() {
    const lines = bulkInput.split('\n').filter((x) => x.trim());
    if (lines.length === 0) { toast({ title: 'Enter URLs', variant: 'destructive' }); return; }
    setLoading(true);
    try {
      const inserts = [];
      for (const rawUrl of lines) {
        const trimmedUrl = rawUrl.trim();
        if (!trimmedUrl) continue;
        const normalizedUrl = /^https?:\/\//i.test(trimmedUrl) ? trimmedUrl : `https://${trimmedUrl}`;
        let code = '';
        let unique = false;
        for (let attempt = 0; attempt < 10; attempt++) {
          code = Math.random().toString(36).substring(2, 7);
          const isUnique = await getDb().isCodeUnique(code);
          if (isUnique) { unique = true; break; }
        }
        if (unique) inserts.push({ code, url: normalizedUrl });
      }
      if (inserts.length > 0) {
        const data = await getDb().createLinks(inserts);
        setResults(data);
        setBulkInput('');
        toast({ title: `${data.length} links created!` });
        onLoad();
      } else {
        toast({ title: 'Error', description: 'Failed to create any links', variant: 'destructive' });
      }
    } catch (err) {
      toast({ title: 'Failed to create link', description: String(err), variant: 'destructive' });
    } finally { setLoading(false); }
  }

  return (
    <div className="space-y-5">
      <div className="bg-gray-900 rounded-2xl p-1.5 border border-gray-800 flex w-fit">
        <button onClick={() => { setMode('single'); setResults([]); }} className={`px-4 py-2 text-xs font-medium rounded-lg transition-all cursor-pointer ${mode === 'single' ? 'bg-emerald-500 text-white shadow-lg' : 'text-gray-500 hover:text-gray-300'}`}>Single Link</button>
        <button onClick={() => { setMode('bulk'); setResults([]); }} className={`px-4 py-2 text-xs font-medium rounded-lg transition-all cursor-pointer ${mode === 'bulk' ? 'bg-emerald-500 text-white shadow-lg' : 'text-gray-500 hover:text-gray-300'}`}>Bulk Links</button>
      </div>

      <div className="bg-gray-900 rounded-2xl p-5 border border-gray-800">
        {mode === 'single' ? (
          <div className="space-y-3">
            <input type="text" value={urlInput} onChange={(e) => setUrlInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleGenerate()} placeholder="Paste your URL here..." className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-xl text-white text-sm placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all" />
            <button onClick={handleGenerate} disabled={loading} className="w-full py-2.5 bg-emerald-500 hover:bg-emerald-600 active:bg-emerald-700 disabled:opacity-50 text-white font-semibold text-sm rounded-xl transition-colors cursor-pointer flex items-center justify-center gap-2">
              {loading ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <><IconPlus /> Generate Link</>}
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <textarea value={bulkInput} onChange={(e) => setBulkInput(e.target.value)} placeholder={"One URL per line:\nhttps://example.com/page1\nhttps://example.com/page2\nhttps://example.com/page3"} rows={5} className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-xl text-white text-sm placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all resize-none" />
            <button onClick={handleBulk} disabled={loading} className="w-full py-2.5 bg-emerald-500 hover:bg-emerald-600 active:bg-emerald-700 disabled:opacity-50 text-white font-semibold text-sm rounded-xl transition-colors cursor-pointer flex items-center justify-center gap-2">
              {loading ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <><IconPlus /> Generate Bulk Links</>}
            </button>
          </div>
        )}
      </div>

      {results.length > 0 && (
        <div className="bg-gray-900 rounded-2xl border border-gray-800">
          <div className="px-5 pt-5 pb-3">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <IconCheck className="w-4 h-4" /> Generated Links
            </h3>
          </div>
          <div className="divide-y divide-gray-800/50 px-5 pb-3">
            {results.map(l => (
              <div key={l.code} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span>{getRandomEmoji()}{getRandomEmoji()}</span>
                    <code className="text-emerald-400 text-sm font-mono font-semibold">{getDomain(customDomain, customDomains, randomDomain)}{l.code}</code>
                  </div>
                  <p className="text-xs text-gray-600 mt-1 truncate">{l.url}</p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => copyText(`${getRandomEmoji()}${getRandomEmoji()} ${getDomain(customDomain, customDomains, randomDomain)}${l.code}`, toast)} className="p-2 hover:bg-gray-800 rounded-lg transition-colors cursor-pointer text-gray-500 hover:text-white" title="Copy with emoji"><IconCopy className="w-4 h-4" /></button>
                  <button onClick={() => { window.open(`https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(getDomain(customDomain, customDomains, randomDomain) + l.code)}`, '_blank'); }} className="p-2 hover:bg-gray-800 rounded-lg transition-colors cursor-pointer text-gray-500 hover:text-white" title="QR"><IconQrCode className="w-4 h-4" /></button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Database Config Component ───────────────────────────────────────
function DatabaseConfigCard({ toast }: { toast: ReturnType<typeof useToast>['toast'] }) {
  const [dbType, setDbType] = useState<DatabaseType>(getDbConfig().type);

  // Supabase fields
  const [supabaseUrl, setSupabaseUrl] = useState(getDbConfig().supabaseUrl || '');
  const [supabaseAnonKey, setSupabaseAnonKey] = useState(getDbConfig().supabaseAnonKey || '');

  // JSONBin fields
  const [jsonbinApiKey, setJsonbinApiKey] = useState(getDbConfig().jsonbinApiKey || '');
  const [jsonbinBinId, setJsonbinBinId] = useState(getDbConfig().jsonbinBinId || '');

  // Firebase fields
  const [firebaseUrl, setFirebaseUrl] = useState(getDbConfig().firebaseUrl || '');
  const [firebaseSecret, setFirebaseSecret] = useState(getDbConfig().firebaseSecret || '');

  // cPanel fields
  const [cpanelApiUrl, setCpanelApiUrl] = useState(getDbConfig().cpanelApiUrl || '');

  // PocketHost fields
  const [pockethostUrl, setPockethostUrl] = useState(getDbConfig().pockethostUrl || '');
  const [pockethostEmail, setPockethostEmail] = useState(getDbConfig().pockethostEmail || '');
  const [pockethostPassword, setPockethostPassword] = useState(getDbConfig().pockethostPassword || '');

  // Restdb.io fields
  const [restdbApiKey, setRestdbApiKey] = useState(getDbConfig().restdbApiKey || '');
  const [restdbDbName, setRestdbDbName] = useState(getDbConfig().restdbDbName || '');

  // Neon fields
  const [neonEndpoint, setNeonEndpoint] = useState(getDbConfig().neonEndpoint || '');
  const [neonRoleKey, setNeonRoleKey] = useState(getDbConfig().neonRoleKey || '');

  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);

  function buildConfig(): DatabaseConfig {
    return {
      type: dbType,
      supabaseUrl, supabaseAnonKey,
      jsonbinApiKey, jsonbinBinId,
      firebaseUrl, firebaseSecret,
      cpanelApiUrl,
      pockethostUrl, pockethostEmail, pockethostPassword,
      restdbApiKey, restdbDbName,
      neonEndpoint, neonRoleKey,
    };
  }

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const config = buildConfig();
      const adapter = createAdapterForTest(config);
      const result = await adapter.testConnection();
      setTestResult({ ok: result.success, msg: result.message });
      toast({
        title: result.success ? 'Connection OK' : 'Connection Failed',
        description: result.message,
        variant: result.success ? 'default' : 'destructive',
      });
    } catch (err) {
      setTestResult({ ok: false, msg: String(err) });
      toast({ title: 'Connection Failed', description: String(err), variant: 'destructive' });
    } finally { setTesting(false); }
  }

  async function handleSave() {
    setSaving(true);
    try {
      const config = buildConfig();
      // Test connection first
      const adapter = createAdapterForTest(config);
      const test = await adapter.testConnection();
      if (!test.success) {
        toast({ title: 'Connection Failed', description: test.message, variant: 'destructive' });
        setSaving(false);
        return;
      }
      // Apply the new database
      switchDatabase(config);
      setTestResult({ ok: true, msg: 'Database switched and connected!' });
      toast({ title: 'Database Saved!', description: `Switched to ${adapter.name}` });
    } catch (err) {
      toast({ title: 'Error', description: String(err), variant: 'destructive' });
    } finally { setSaving(false); }
  }

  const inputClass = "w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent placeholder-gray-600 transition-all";

  return (
    <div className="bg-gray-900 rounded-2xl p-5 border border-gray-800">
      <div className="flex items-center gap-3 mb-5">
        <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-violet-500/10 ring-1 ring-violet-500/20">
          <IconDatabase className="w-5 h-5 text-violet-400" />
        </div>
        <div>
          <h2 className="text-sm font-bold text-white">Database</h2>
          <p className="text-xs text-gray-500 mt-0.5">Active: <span className="text-violet-400">{getDbName()}</span></p>
        </div>
      </div>

      <div className="space-y-4">
        {/* Database Type Selector */}
        <div>
          <label className="text-xs text-gray-500 mb-2 block">Database Type</label>
          <select
            value={dbType}
            onChange={(e) => { setDbType(e.target.value as DatabaseType); setTestResult(null); }}
            className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 cursor-pointer"
          >
            {DATABASE_OPTIONS.map(opt => (
              <option key={opt.type} value={opt.type}>{opt.name} — {opt.free}</option>
            ))}
          </select>
          <p className="text-xs text-gray-600 mt-1.5">
            {DATABASE_OPTIONS.find(o => o.type === dbType)?.description}
          </p>
        </div>

        {/* Dynamic Config Fields */}
        {dbType === 'supabase' && (
          <div className="space-y-3">
            <div>
              <label className="text-xs text-gray-500 mb-1.5 block">Supabase Project URL</label>
              <input type="url" value={supabaseUrl} onChange={(e) => setSupabaseUrl(e.target.value)} placeholder="https://your-project.supabase.co" className={inputClass} />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1.5 block">Supabase Anon Key</label>
              <input type="text" value={supabaseAnonKey} onChange={(e) => setSupabaseAnonKey(e.target.value)} placeholder="eyJhbGciOiJIUzI1NiIs..." className={inputClass} />
            </div>
          </div>
        )}

        {dbType === 'jsonbin' && (
          <div className="space-y-3">
            <div>
              <label className="text-xs text-gray-500 mb-1.5 block">JSONBin.io API Key</label>
              <input type="text" value={jsonbinApiKey} onChange={(e) => setJsonbinApiKey(e.target.value)} placeholder="$2a$10$..." className={inputClass} />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1.5 block">Bin ID <span className="text-gray-700">(auto-created if empty)</span></label>
              <input type="text" value={jsonbinBinId} onChange={(e) => setJsonbinBinId(e.target.value)} placeholder="Leave empty to auto-create" className={inputClass} />
            </div>
          </div>
        )}

        {dbType === 'firebase' && (
          <div className="space-y-3">
            <div>
              <label className="text-xs text-gray-500 mb-1.5 block">Firebase Database URL</label>
              <input type="url" value={firebaseUrl} onChange={(e) => setFirebaseUrl(e.target.value)} placeholder="https://your-project-default-rtdb.firebaseio.com" className={inputClass} />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1.5 block">Database Secret <span className="text-gray-700">(optional)</span></label>
              <input type="password" value={firebaseSecret} onChange={(e) => setFirebaseSecret(e.target.value)} placeholder="Optional, for authenticated access" className={inputClass} />
            </div>
          </div>
        )}

        {dbType === 'cpanel' && (
          <div className="space-y-3">
            <div>
              <label className="text-xs text-gray-500 mb-1.5 block">cPanel API URL</label>
              <input type="url" value={cpanelApiUrl} onChange={(e) => setCpanelApiUrl(e.target.value)} placeholder="https://yourdomain.com/cpanel-api.php" className={inputClass} />
            </div>
            <div className="bg-gray-800/50 rounded-xl p-3 border border-gray-700/50">
              <p className="text-xs text-gray-400 leading-relaxed">
                Upload <code className="text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded">cpanel-api.php</code> and import{' '}
                <code className="text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded">cpanel-database.sql</code> to your cPanel MySQL.
                Both files are included in this project.
              </p>
            </div>
          </div>
        )}

        {dbType === 'pockethost' && (
          <div className="space-y-3">
            <div>
              <label className="text-xs text-gray-500 mb-1.5 block">PocketHost URL</label>
              <input type="url" value={pockethostUrl} onChange={(e) => setPockethostUrl(e.target.value)} placeholder="https://yourproject.pockethost.io" className={inputClass} />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1.5 block">Admin Email</label>
              <input type="email" value={pockethostEmail} onChange={(e) => setPockethostEmail(e.target.value)} placeholder="admin@example.com" className={inputClass} />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1.5 block">Admin Password</label>
              <input type="password" value={pockethostPassword} onChange={(e) => setPockethostPassword(e.target.value)} placeholder="Your PocketBase admin password" className={inputClass} />
            </div>
            <div className="bg-gray-800/50 rounded-xl p-3 border border-gray-700/50">
              <p className="text-xs text-gray-400 leading-relaxed">
                Create a project at <code className="text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded">pockethost.io</code>, then create 2 collections:{' '}
                <code className="text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded">settings</code> (key, value) and{' '}
                <code className="text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded">short_links</code> (code, url, clicks, created_at).
              </p>
            </div>
          </div>
        )}

        {dbType === 'restdb' && (
          <div className="space-y-3">
            <div>
              <label className="text-xs text-gray-500 mb-1.5 block">API Key</label>
              <input type="text" value={restdbApiKey} onChange={(e) => setRestdbApiKey(e.target.value)} placeholder="Paste your restdb.io API key" className={inputClass} />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1.5 block">Database Name</label>
              <input type="text" value={restdbDbName} onChange={(e) => setRestdbDbName(e.target.value)} placeholder="e.g., my-safelink-db-1234" className={inputClass} />
            </div>
            <div className="bg-gray-800/50 rounded-xl p-3 border border-gray-700/50">
              <p className="text-xs text-gray-400 leading-relaxed">
                Sign up at <code className="text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded">restdb.io</code>, create a new database, then create 2 data nodes:{' '}
                <code className="text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded">settings</code> and{' '}
                <code className="text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded">short_links</code>. Collections are automatically created when data is first saved.
              </p>
            </div>
          </div>
        )}

        {dbType === 'neon' && (
          <div className="space-y-3">
            <div>
              <label className="text-xs text-gray-500 mb-1.5 block">Endpoint Hostname</label>
              <input type="text" value={neonEndpoint} onChange={(e) => setNeonEndpoint(e.target.value)} placeholder="ep-name-12345.us-east-2.aws.neon.tech" className={inputClass} />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1.5 block">Role Key (Password)</label>
              <input type="password" value={neonRoleKey} onChange={(e) => setNeonRoleKey(e.target.value)} placeholder="Database role password from connection string" className={inputClass} />
            </div>
            <div className="bg-gray-800/50 rounded-xl p-3 border border-gray-700/50">
              <p className="text-xs text-gray-400 leading-relaxed">
                Create a project at <code className="text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded">neon.tech</code>, then run the following SQL in the SQL Editor:
              </p>
              <pre className="text-[10px] text-emerald-400/80 mt-1.5 bg-black/30 rounded-lg p-2 overflow-x-auto font-mono">
{`CREATE TABLE settings (
  key VARCHAR(100) PRIMARY KEY,
  value TEXT
);
CREATE TABLE short_links (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  code VARCHAR(50) UNIQUE NOT NULL,
  url TEXT NOT NULL,
  clicks INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);`}
              </pre>
            </div>
          </div>
        )}

        {/* Test Result */}
        {testResult && (
          <div className={`text-xs px-3 py-2.5 rounded-lg border ${testResult.ok ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-red-500/10 border-red-500/30 text-red-400'}`}>
            {testResult.msg}
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex gap-3 pt-1">
          <button onClick={handleTest} disabled={testing} className="py-2.5 px-5 bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-gray-300 hover:text-white text-xs font-medium rounded-xl transition-colors cursor-pointer flex items-center gap-2 border border-gray-700">
            {testing ? <div className="w-4 h-4 border-2 border-gray-500 border-t-gray-300 rounded-full animate-spin" /> : <IconPlug className="w-3.5 h-3.5" />}
            Test
          </button>
          <button onClick={handleSave} disabled={saving} className="flex-1 py-2.5 bg-violet-500 hover:bg-violet-600 active:bg-violet-700 disabled:opacity-50 text-white font-semibold text-xs rounded-xl transition-colors cursor-pointer flex items-center justify-center gap-2 shadow-lg shadow-violet-500/20">
            {saving ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <><IconCheck className="w-3.5 h-3.5" /> Save & Switch</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// Helper to create a temporary adapter for testing without switching
function createAdapterForTest(config: DatabaseConfig) {
  return createAdapter(config);
}

// ─── Settings Tab ────────────────────────────────────────────────────
function SettingsTab({ toast, onSettingsChange }: { toast: ReturnType<typeof useToast>['toast']; onSettingsChange: (settings: SettingsData) => void }) {
  const [adminPin, setAdminPin] = useState('');
  const [redirectTime, setRedirectTime] = useState('5');
  const [waChannelShow, setWaChannelShow] = useState(false);
  const [waChannelUrl, setWaChannelUrl] = useState('');
  const [fbGroupShow, setFbGroupShow] = useState(false);
  const [fbGroupUrl, setFbGroupUrl] = useState('');
  const [customDomain, setCustomDomain] = useState('');
  const [siteName, setSiteName] = useState('');
  const [themeColor, setThemeColor] = useState('emerald');
  const [themeMode, setThemeMode] = useState('dark');
  const [customDomains, setCustomDomains] = useState('');
  const [randomDomain, setRandomDomain] = useState(false);
  const [ogTitle, setOgTitle] = useState('');
  const [ogDescription, setOgDescription] = useState('');
  const [ogImage, setOgImage] = useState('');
  const [ogType, setOgType] = useState('website');
  const [fbAppId, setFbAppId] = useState('');
  const [ogSiteName, setOgSiteName] = useState('');
  const [footerUrl, setFooterUrl] = useState('');
  const [autoDeleteDays, setAutoDeleteDays] = useState('0');
  const [autoDeleteMode, setAutoDeleteMode] = useState<'age' | 'inactive'>('age');
  const [fallbackUrl, setFallbackUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const data = await getDb().getAllSettings();
        if (data) {
          data.forEach((row) => {
            switch (row.key) {
              case 'admin_pin': setAdminPin(row.value); break;
              case 'redirect_time': setRedirectTime(row.value); break;
              case 'wa_channel_show': setWaChannelShow(row.value === 'true'); break;
              case 'wa_channel_url': setWaChannelUrl(row.value); break;
              case 'fb_group_show': setFbGroupShow(row.value === 'true'); break;
              case 'fb_group_url': setFbGroupUrl(row.value); break;
              case 'custom_domain': setCustomDomain(row.value); break;
              case 'site_name': setSiteName(row.value); break;
              case 'theme_color': setThemeColor(row.value); break;
              case 'theme_mode': setThemeMode(row.value); break;
              case 'custom_domains': setCustomDomains(row.value); break;
              case 'random_domain': setRandomDomain(row.value === 'true'); break;
              case 'og_title': setOgTitle(row.value); break;
              case 'og_description': setOgDescription(row.value); break;
              case 'og_image': setOgImage(row.value); break;
              case 'og_type': setOgType(row.value); break;
              case 'fb_app_id': setFbAppId(row.value); break;
              case 'og_site_name': setOgSiteName(row.value); break;
              case 'footer_url': setFooterUrl(row.value); break;
              case 'auto_delete_days': setAutoDeleteDays(row.value); break;
              case 'auto_delete_mode': setAutoDeleteMode((row.value === 'inactive' ? 'inactive' : 'age')); break;
              case 'fallback_url': setFallbackUrl(row.value); break;
            }
          });
        }
      } catch { /* silent */ }
      setLoading(false);
    }
    load();
  }, []);

  // Apply theme
  useEffect(() => {
    const colors: Record<string, string> = {
      emerald: '#10b981', blue: '#3b82f6', purple: '#8b5cf6',
      red: '#ef4444', orange: '#f97316', pink: '#ec4899', cyan: '#06b6d4',
    };
    const hoverColors: Record<string, string> = {
      emerald: '#059669', blue: '#2563eb', purple: '#7c3aed',
      red: '#dc2626', orange: '#ea580c', pink: '#db2777', cyan: '#0891b2',
    };
    const color = colors[themeColor] || colors.emerald;
    const hoverColor = hoverColors[themeColor] || hoverColors.emerald;
    // Compute shadow with alpha
    const r = parseInt(color.slice(1,3), 16);
    const g = parseInt(color.slice(3,5), 16);
    const b = parseInt(color.slice(5,7), 16);
    const shadow = `rgba(${r}, ${g}, ${b}, 0.2)`;

    const root = document.documentElement;
    root.style.setProperty('--accent', color);
    root.style.setProperty('--accent-hover', hoverColor);
    root.style.setProperty('--accent-shadow', shadow);

    if (themeMode === 'light') {
      root.style.setProperty('--bg-primary', '#f9fafb');
      root.style.setProperty('--bg-card', '#ffffff');
      root.style.setProperty('--bg-input', '#f3f4f6');
      root.style.setProperty('--text-primary', '#111827');
      root.style.setProperty('--text-secondary', '#6b7280');
      root.style.setProperty('--text-muted', '#9ca3af');
      root.style.setProperty('--border-color', '#e5e7eb');
      root.style.setProperty('--border-hover', '#d1d5db');
      root.style.setProperty('--scrollbar-thumb', '#d1d5db');
      root.style.setProperty('--scrollbar-thumb-hover', '#9ca3af');
      root.style.setProperty('--select-bg', '#ffffff');
    } else {
      root.style.setProperty('--bg-primary', '#030712');
      root.style.setProperty('--bg-card', '#111827');
      root.style.setProperty('--bg-input', '#1f2937');
      root.style.setProperty('--text-primary', '#f9fafb');
      root.style.setProperty('--text-secondary', '#9ca3af');
      root.style.setProperty('--text-muted', '#6b7280');
      root.style.setProperty('--border-color', '#1f2937');
      root.style.setProperty('--border-hover', '#374151');
      root.style.setProperty('--scrollbar-thumb', '#374151');
      root.style.setProperty('--scrollbar-thumb-hover', '#4b5563');
      root.style.setProperty('--select-bg', '#1f2937');
    }
  }, [themeColor, themeMode]);

  // Apply OG tags and site name
  useEffect(() => {
    const name = siteName || 'SafeLink';
    document.title = name;
    const setMeta = (prop: string, content: string) => {
      let el = document.querySelector(`meta[property="${prop}"]`) as HTMLMetaElement;
      if (el) el.content = content;
    };
    const setMetaName = (name: string, content: string) => {
      let el = document.querySelector(`meta[name="${name}"]`) as HTMLMetaElement;
      if (el) el.content = content;
    };
    setMeta('og:title', ogTitle || name);
    setMeta('og:description', ogDescription || 'SafeLink - Protected URL Shortener');
    setMeta('og:image', ogImage);
    setMeta('og:url', window.location.href);
    setMeta('og:type', ogType || 'website');
    setMeta('og:site_name', ogSiteName || name);
    if (fbAppId) setMeta('fb:app_id', fbAppId);
    else {
      const fbEl = document.querySelector('meta[property="fb:app_id"]');
      if (fbEl) fbEl.remove();
    }
  }, [siteName, ogTitle, ogDescription, ogImage, ogType, fbAppId, ogSiteName]);

  async function handleSave() {
    setSaving(true);
    try {
      const upserts = [
        { key: 'admin_pin', value: adminPin },
        { key: 'redirect_time', value: redirectTime },
        { key: 'wa_channel_show', value: String(waChannelShow) },
        { key: 'wa_channel_url', value: waChannelUrl },
        { key: 'fb_group_show', value: String(fbGroupShow) },
        { key: 'fb_group_url', value: fbGroupUrl },
        { key: 'custom_domain', value: customDomain },
        { key: 'site_name', value: siteName },
        { key: 'theme_color', value: themeColor },
        { key: 'theme_mode', value: themeMode },
        { key: 'custom_domains', value: customDomains },
        { key: 'random_domain', value: String(randomDomain) },
        { key: 'og_title', value: ogTitle },
        { key: 'og_description', value: ogDescription },
        { key: 'og_image', value: ogImage },
        { key: 'og_type', value: ogType },
        { key: 'fb_app_id', value: fbAppId },
        { key: 'og_site_name', value: ogSiteName },
        { key: 'footer_url', value: footerUrl },
        { key: 'auto_delete_days', value: autoDeleteDays },
        { key: 'auto_delete_mode', value: autoDeleteMode },
        { key: 'cleanup_days', value: autoDeleteDays },
        { key: 'fallback_url', value: fallbackUrl },
      ];
      const result = await getDb().upsertSettings(upserts);
      if (result.success) {
        toast({ title: 'Settings saved!' });
        onSettingsChange({ custom_domain: customDomain, custom_domains: customDomains, random_domain: randomDomain, site_name: siteName, theme_color: themeColor, theme_mode: themeMode });
      } else {
        toast({ title: 'Error', description: result.error, variant: 'destructive' });
      }
    } catch (err) {
      toast({ title: 'Error', description: String(err), variant: 'destructive' });
    } finally { setSaving(false); }
  }

  async function handleReset() {
    if (!confirm('Reset all CTA and redirect settings to defaults? Your admin PIN will be kept.')) return;
    setResetting(true);
    try {
      const resetValues = [
        { key: 'redirect_time', value: '5' },
        { key: 'wa_channel_show', value: 'false' },
        { key: 'wa_channel_url', value: '' },
        { key: 'fb_group_show', value: 'false' },
        { key: 'fb_group_url', value: '' },
        { key: 'custom_domain', value: '' },
      ];
      const result = await getDb().upsertSettings(resetValues);
      if (result.success) {
        setRedirectTime('5');
        setWaChannelShow(false);
        setWaChannelUrl('');
        setFbGroupShow(false);
        setFbGroupUrl('');
        setCustomDomain('');
        onSettingsChange({ custom_domain: '', custom_domains: '', random_domain: false, site_name: '', theme_color: '', theme_mode: '' });
        toast({ title: 'Settings reset!', description: 'CTA settings restored to defaults' });
      } else {
        toast({ title: 'Error', description: result.error, variant: 'destructive' });
      }
    } catch (err) {
      toast({ title: 'Error', description: String(err), variant: 'destructive' });
    } finally { setResetting(false); }
  }

  if (loading) {
    return <div className="flex items-center justify-center py-20"><div className="w-10 h-10 border-3 border-gray-700 border-t-emerald-500 rounded-full animate-spin" style={{ borderWidth: '3px' }} /></div>;
  }

  const currentDefaultDomain = typeof window !== 'undefined' ? window.location.origin + window.location.pathname.replace(/\/$/, '') : '';

  return (
    <div className="space-y-6">
      {/* Database Configuration Card - NEW */}
      <DatabaseConfigCard toast={toast} />

      {/* Saved Database Configs */}
      <SavedConfigs toast={toast} />

      {/* Deploy Config File — fixes "Link not found" for visitors */}
      <div className="bg-gray-900 rounded-2xl p-5 border border-gray-800">
        <div className="flex items-center gap-3 mb-4">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-cyan-500/10 ring-1 ring-cyan-500/20">
            <svg className="w-5 h-5 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
          </div>
          <div>
            <h2 className="text-sm font-bold text-white">Deploy Config File</h2>
            <p className="text-xs text-gray-500 mt-0.5">Fix "Link not found" for visitors on other browsers</p>
          </div>
        </div>
        <div className="bg-cyan-500/10 border border-cyan-500/20 rounded-xl p-3 mb-4">
          <p className="text-xs text-cyan-400">
            ⚠️ When visitors open your short link in a new browser, the app doesn't know which database to use. Download this config file and upload it to your hosting (same folder as index.html) to fix this.
          </p>
        </div>
        <button
          onClick={() => {
            const config = getDbConfig();
            const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'safelink-config.json';
            a.click();
            URL.revokeObjectURL(url);
            toast({ title: 'Config Downloaded!', description: 'Upload safelink-config.json to your hosting root (same folder as index.html)' });
          }}
          className="w-full py-3 bg-cyan-500 hover:bg-cyan-600 active:bg-cyan-700 text-white font-semibold text-sm rounded-xl transition-colors cursor-pointer flex items-center justify-center gap-2 shadow-lg shadow-cyan-500/20"
        >
          <IconDownload className="w-4 h-4" /> Download safelink-config.json
        </button>
      </div>

      {/* Security Card */}
      <div className="bg-gray-900 rounded-2xl p-5 border border-gray-800">
        <div className="flex items-center gap-3 mb-5">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-emerald-500/10 ring-1 ring-emerald-500/20">
            <IconShield className="w-5 h-5 text-emerald-400" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-white">Security</h2>
            <p className="text-xs text-gray-500 mt-0.5">PIN & redirect settings</p>
          </div>
        </div>
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <IconKey className="w-5 h-5 text-gray-500 shrink-0" />
            <span className="text-sm text-gray-400 w-28 shrink-0">Admin PIN</span>
            <input type="text" value={adminPin} onChange={(e) => setAdminPin(e.target.value)} placeholder="Enter login PIN" className="flex-1 min-w-0 px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent placeholder-gray-600 transition-all" />
          </div>
          <div className="flex items-center gap-3">
            <IconShield className="w-5 h-5 text-gray-500 shrink-0" />
            <span className="text-sm text-gray-400 w-28 shrink-0">Redirect</span>
            <select value={redirectTime} onChange={(e) => setRedirectTime(e.target.value)} className="flex-1 min-w-0 px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 cursor-pointer transition-all">
              <option value="0">0s — instant redirect</option>
              <option value="1">1 second</option>
              <option value="2">2 seconds</option>
              <option value="3">3 seconds</option>
              <option value="5">5 seconds</option>
              <option value="10">10 seconds</option>
              <option value="15">15 seconds</option>
              <option value="20">20 seconds</option>
              <option value="30">30 seconds</option>
            </select>
          </div>
        </div>
      </div>

      {/* Domain Card */}
      <div className="bg-gray-900 rounded-2xl p-5 border border-gray-800">
        <div className="flex items-center gap-3 mb-5">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-teal-500/10 ring-1 ring-teal-500/20">
            <IconGlobe className="w-5 h-5 text-teal-400" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-white">Domain</h2>
            <p className="text-xs text-gray-500 mt-0.5">Custom link prefix</p>
          </div>
        </div>
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-400 w-28 shrink-0">Custom URL</span>
            <input
              type="text"
              value={customDomain}
              onChange={(e) => setCustomDomain(e.target.value)}
              placeholder={currentDefaultDomain || 'xsafe.biz.id'}
              className="flex-1 min-w-0 px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent placeholder-gray-600 transition-all"
            />
          </div>
          {customDomain && (
            <div className="flex items-center gap-2 pl-[calc(7rem+0.75rem)]">
              <span className="text-xs text-gray-600">Preview:</span>
              <code className="text-xs text-emerald-400/80 font-mono bg-emerald-500/10 px-2.5 py-1 rounded-lg break-all">{ensureProtocol(customDomain)}/#abc123</code>
            </div>
          )}
        </div>
      </div>

      {/* Channels Card */}
      <div className="bg-gray-900 rounded-2xl p-5 border border-gray-800">
        <div className="flex items-center gap-3 mb-5">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-emerald-500/10 ring-1 ring-emerald-500/20">
            <IconChartBar className="w-5 h-5 text-emerald-400" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-white">Channels</h2>
            <p className="text-xs text-gray-500 mt-0.5">CTA buttons on redirect page</p>
          </div>
        </div>
        <div className="space-y-4">
          {/* WhatsApp */}
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <WhatsAppIcon className="w-5 h-5 text-gray-500 shrink-0" />
              <span className="text-sm text-gray-400 flex-1">WhatsApp Channel</span>
              <Toggle enabled={waChannelShow} onChange={setWaChannelShow} />
            </div>
            {waChannelShow && (
              <input type="url" value={waChannelUrl} onChange={(e) => setWaChannelUrl(e.target.value)} placeholder="https://whatsapp.com/channel/..." className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent placeholder-gray-600 transition-all" />
            )}
          </div>
          {/* Facebook */}
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <IconFacebook className="w-5 h-5 text-gray-500 shrink-0" />
              <span className="text-sm text-gray-400 flex-1">Facebook Group</span>
              <Toggle enabled={fbGroupShow} onChange={setFbGroupShow} />
            </div>
            {fbGroupShow && (
              <input type="url" value={fbGroupUrl} onChange={(e) => setFbGroupUrl(e.target.value)} placeholder="https://facebook.com/groups/..." className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent placeholder-gray-600 transition-all" />
            )}
          </div>
        </div>
      </div>

      {/* Site Name Card */}
      <div className="bg-gray-900 rounded-2xl p-5 border border-gray-800">
        <div className="flex items-center gap-3 mb-5">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-amber-500/10 ring-1 ring-amber-500/20">
            <IconLink className="w-5 h-5 text-amber-400" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-white">Site Name</h2>
            <p className="text-xs text-gray-500 mt-0.5">Name displayed in browser tab</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-400 w-28 shrink-0">Site Name</span>
          <input type="text" value={siteName} onChange={(e) => setSiteName(e.target.value)} placeholder="SafeLink" className="flex-1 min-w-0 px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent placeholder-gray-600 transition-all" />
        </div>
      </div>

      {/* Theme & Appearance Card */}
      <div className="bg-gray-900 rounded-2xl p-5 border border-gray-800">
        <div className="flex items-center gap-3 mb-5">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-pink-500/10 ring-1 ring-pink-500/20">
            <IconPalette className="w-5 h-5 text-pink-400" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-white">Theme & Appearance</h2>
            <p className="text-xs text-gray-500 mt-0.5">Accent color and display mode</p>
          </div>
        </div>
        <div className="space-y-4">
          <div>
            <label className="text-xs text-gray-500 mb-2 block">Accent Color</label>
            <div className="flex gap-2.5 flex-wrap">
              {([
                { key: 'emerald', color: '#10b981' },
                { key: 'blue', color: '#3b82f6' },
                { key: 'purple', color: '#8b5cf6' },
                { key: 'red', color: '#ef4444' },
                { key: 'orange', color: '#f97316' },
                { key: 'pink', color: '#ec4899' },
                { key: 'cyan', color: '#06b6d4' },
              ] as const).map(c => (
                <button
                  key={c.key}
                  onClick={() => setThemeColor(c.key)}
                  className={`w-8 h-8 rounded-full transition-all cursor-pointer ring-2 ring-offset-2 ring-offset-gray-900 ${themeColor === c.key ? 'ring-white scale-110' : 'ring-transparent hover:scale-105'}`}
                  style={{ backgroundColor: c.color }}
                  title={c.key}
                />
              ))}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-400 flex-1">Light Mode</span>
            <Toggle enabled={themeMode === 'light'} onChange={(v) => setThemeMode(v ? 'light' : 'dark')} />
          </div>
        </div>
      </div>

      {/* Multi-Domain Card */}
      <div className="bg-gray-900 rounded-2xl p-5 border border-gray-800">
        <div className="flex items-center gap-3 mb-5">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-cyan-500/10 ring-1 ring-cyan-500/20">
            <IconGlobe className="w-5 h-5 text-cyan-400" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-white">Multi-Domain</h2>
            <p className="text-xs text-gray-500 mt-0.5">Use multiple domains for shortlinks</p>
          </div>
        </div>
        <div className="space-y-4">
          <div>
            <label className="text-xs text-gray-500 mb-1.5 block">Custom Domains <span className="text-gray-700">(comma-separated)</span></label>
            <textarea value={customDomains} onChange={(e) => setCustomDomains(e.target.value)} placeholder="domain1.com, domain2.com, domain3.com" rows={3} className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent placeholder-gray-600 transition-all resize-none" />
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-400 flex-1">Random Domain</span>
            <Toggle enabled={randomDomain} onChange={setRandomDomain} />
          </div>
          <p className="text-xs text-gray-600">When enabled, each link will use a random domain from the list above.</p>
        </div>
      </div>

      {/* SEO / Facebook OG Card */}
      <div className="bg-gray-900 rounded-2xl p-5 border border-gray-800">
        <div className="flex items-center gap-3 mb-5">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-blue-500/10 ring-1 ring-blue-500/20">
            <IconFacebook className="w-5 h-5 text-blue-400" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-white">SEO / Facebook OG</h2>
            <p className="text-xs text-gray-500 mt-0.5">Open Graph meta tags for social sharing</p>
          </div>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-gray-500 mb-1.5 block">OG Title</label>
            <input type="text" value={ogTitle} onChange={(e) => setOgTitle(e.target.value)} placeholder="SafeLink" className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent placeholder-gray-600 transition-all" />
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1.5 block">OG Description</label>
            <input type="text" value={ogDescription} onChange={(e) => setOgDescription(e.target.value)} placeholder="SafeLink - Protected URL Shortener" className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent placeholder-gray-600 transition-all" />
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1.5 block">OG Image URL</label>
            <input type="url" value={ogImage} onChange={(e) => setOgImage(e.target.value)} placeholder="https://example.com/og-image.jpg" className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent placeholder-gray-600 transition-all" />
            {ogImage && (
              <div className="mt-2 rounded-lg overflow-hidden border border-gray-700 max-w-sm">
                <img src={ogImage} alt="OG Preview" className="w-full h-auto" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
              </div>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500 mb-1.5 block">OG Type</label>
              <select value={ogType} onChange={(e) => setOgType(e.target.value)} className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer">
                <option value="website">Website</option>
                <option value="article">Article</option>
                <option value="profile">Profile</option>
                <option value="video.other">Video</option>
                <option value="music.song">Music</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1.5 block">Facebook App ID</label>
              <input type="text" value={fbAppId} onChange={(e) => setFbAppId(e.target.value)} placeholder="123456789012345" className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent placeholder-gray-600 transition-all" />
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1.5 block">OG Site Name</label>
            <input type="text" value={ogSiteName} onChange={(e) => setOgSiteName(e.target.value)} placeholder={siteName || 'SafeLink'} className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent placeholder-gray-600 transition-all" />
          </div>
        </div>
      </div>

      {/* Footer Card */}
      <div className="bg-gray-900 rounded-2xl p-5 border border-gray-800">
        <div className="flex items-center gap-3 mb-5">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-violet-500/10 ring-1 ring-violet-500/20">
            <IconLink className="w-5 h-5 text-violet-400" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-white">Footer</h2>
            <p className="text-xs text-gray-500 mt-0.5">Footer link on redirect page</p>
          </div>
        </div>
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-400 w-28 shrink-0">Footer URL</span>
            <input type="url" value={footerUrl} onChange={(e) => setFooterUrl(e.target.value)} placeholder="https://yoursite.com" className="flex-1 min-w-0 px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent placeholder-gray-600 transition-all" />
          </div>
          <p className="text-xs text-gray-600">This URL will appear as a "Powered by SafeLink" link on the safelink/redirect page.</p>
        </div>
      </div>

      {/* Auto-Delete Card */}
      <div className="bg-gray-900 rounded-2xl p-5 border border-gray-800">
        <div className="flex items-center gap-3 mb-5">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-red-500/10 ring-1 ring-red-500/20">
            <svg className="w-5 h-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
          </div>
          <div>
            <h2 className="text-sm font-bold text-white">Auto-Delete Links</h2>
            <p className="text-xs text-gray-500 mt-0.5">Automatically remove old or inactive links</p>
          </div>
        </div>
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-400 w-32 shrink-0">Delete After</span>
            <select value={autoDeleteDays} onChange={(e) => setAutoDeleteDays(e.target.value)} className="flex-1 min-w-0 px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-red-500 cursor-pointer">
              <option value="0">Disabled</option>
              <option value="7">7 days</option>
              <option value="15">15 days</option>
              <option value="30">30 days</option>
              <option value="60">60 days</option>
              <option value="90">90 days</option>
            </select>
          </div>
          {autoDeleteDays !== '0' && (
            <>
              <div className="flex items-center gap-3">
                <span className="text-sm text-gray-400 w-32 shrink-0">Mode</span>
                <select value={autoDeleteMode} onChange={(e) => setAutoDeleteMode(e.target.value as 'age' | 'inactive')} className="flex-1 min-w-0 px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-red-500 cursor-pointer">
                  <option value="age">By Age — delete ALL links older than N days</option>
                  <option value="inactive">No Activity — delete links with 0 clicks older than N days</option>
                </select>
              </div>
              <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3">
                <p className="text-xs text-red-400">
                  ⚠️ Links will be auto-deleted when the redirect page is visited. With <strong>{autoDeleteDays} days</strong> setting in <strong>{autoDeleteMode === 'age' ? 'By Age' : 'No Activity'}</strong> mode.
                </p>
              </div>
            </>
          )}
          <p className="text-xs text-gray-600">Cleanup runs once per day when any short link is visited. Deleted links cannot be recovered.</p>
        </div>
      </div>

      {/* Fallback Redirect URL Card */}
      <div className="bg-gray-900 rounded-2xl p-5 border border-gray-800">
        <div className="flex items-center gap-3 mb-5">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-amber-500/10 ring-1 ring-amber-500/20">
            <svg className="w-5 h-5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>
          </div>
          <div>
            <h2 className="text-sm font-bold text-white">Fallback Redirect URL</h2>
            <p className="text-xs text-gray-500 mt-0.5">Redirect visitors here when a short link is not found or inactive</p>
          </div>
        </div>
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-400 w-32 shrink-0">Fallback URL</span>
            <input type="url" value={fallbackUrl} onChange={(e) => setFallbackUrl(e.target.value)} placeholder="https://example.com/fallback" className="flex-1 min-w-0 px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 placeholder-gray-600" />
          </div>
          <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3">
            <p className="text-xs text-amber-400">
              💡 When a visitor opens a short link that doesn't exist or has been deleted, they will be automatically redirected to this URL. Leave empty to show "Link Not Found" page.
            </p>
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex gap-3">
        <button onClick={handleSave} disabled={saving} className="flex-1 py-3 bg-emerald-500 hover:bg-emerald-600 active:bg-emerald-700 disabled:opacity-50 text-white font-semibold text-sm rounded-xl transition-colors cursor-pointer flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20">
          {saving ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <><IconCheck className="w-4 h-4" /> Save Settings</>}
        </button>
        <button onClick={handleReset} disabled={resetting} className="py-3 px-6 bg-gray-800 hover:bg-gray-700 active:bg-gray-600 disabled:opacity-50 text-gray-400 hover:text-white font-medium text-sm rounded-xl transition-colors cursor-pointer flex items-center justify-center gap-2 border border-gray-700">
          {resetting ? <div className="w-5 h-5 border-2 border-gray-500 border-t-gray-300 rounded-full animate-spin" /> : <><IconTrash className="w-4 h-4" /> Reset</>}
        </button>
      </div>
    </div>
  );
}

// ─── Tutorial Tab ────────────────────────────────────────────────────
function TutorialTab() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);
  const sections = [
    { title: 'What is SafeLink?', content: '<p>SafeLink is a URL shortener application equipped with safelink features. Safelink acts as an intermediary between visitors and the destination URL, displaying an article page before automatic redirection occurs.</p><p>Key SafeLink features include:</p><ul class="list-disc pl-5 space-y-1"><li>Shorten long URLs into compact links</li><li>Safelink page with random articles for SEO</li><li>Click tracking for every link</li><li>WhatsApp and Facebook CTA on the redirect page</li><li>Admin dashboard to manage all links</li><li>Support for multiple databases (Supabase, Firebase, etc.)</li></ul>' },
    { title: 'How to Create Shortlinks', content: '<p>Creating shortlinks with SafeLink is very easy:</p><ol class="list-decimal pl-5 space-y-2"><li><strong>Login to Admin Panel</strong> — Open your page and add <code class="bg-gray-800 px-1.5 py-0.5 rounded text-emerald-400">#admin</code> to the URL. Enter your PIN to log in.</li><li><strong>Open the Create Tab</strong> — Click the "Create" tab in the sidebar or bottom navigation.</li><li><strong>Single Mode</strong> — Paste the URL you want to shorten in the input field, then click "Generate Link".</li><li><strong>Bulk Mode</strong> — To create multiple links at once, select the "Bulk Links" tab, enter one URL per line, then click "Generate Bulk Links".</li><li><strong>Copy the Link</strong> — Click the copy icon to copy the generated shortlink. Links include random emojis for sharing purposes.</li></ol>' },
    { title: 'How to Configure Database', content: '<p>SafeLink supports various database backends. You can switch databases at any time via Settings → Database:</p><ul class="list-disc pl-5 space-y-2"><li><strong>Supabase</strong> — Free PostgreSQL, great for production. Create a project at supabase.com, copy the URL and anon key.</li><li><strong>JSONBin.io</strong> — Easiest option, no database setup needed. Sign up at jsonbin.io and get an API key.</li><li><strong>Firebase</strong> — Google Realtime Database, free 1GB. Create a project at console.firebase.google.com.</li><li><strong>cPanel MySQL</strong> — For traditional hosting. Upload the provided PHP proxy file.</li><li><strong>PocketHost</strong> — PocketBase as a service, free. Create a project at pockethost.io.</li><li><strong>Restdb.io</strong> — Simple REST database, free 1000 records.</li><li><strong>Neon</strong> — Serverless Postgres, free 0.5GB. Create a project at neon.tech.</li></ul><p>Click "Test" to verify the connection works, then "Save & Switch" to save.</p>' },
    { title: 'SafeLink Settings', content: '<p>Di tab Settings, Anda bisa mengatur berbagai aspek SafeLink:</p><ul class="list-disc pl-5 space-y-2"><li><strong>Admin PIN</strong> — Ubah PIN login admin. Default: 270491.</li><li><strong>Redirect Time</strong> — Atur waktu tunggu sebelum redirect otomatis (0-30 detik).</li><li><strong>Custom Domain</strong> — Gunakan domain sendiri untuk shortlink, misalnya xsafe.biz.id.</li><li><strong>Multi-Domain</strong> — Tambahkan beberapa domain yang dipisahkan koma. Aktifkan "Random Domain" untuk menggunakan domain acak.</li><li><strong>WhatsApp & Facebook</strong> — Tampilkan tombol CTA di halaman redirect untuk mengarahkan pengunjung ke channel/group Anda.</li><li><strong>Theme & Appearance</strong> — Pilih warna aksen dan mode gelap/terang.</li><li><strong>SEO / Facebook</strong> — Atur OG meta tags untuk social sharing.</li><li><strong>Footer</strong> — Tambahkan tautan footer di halaman redirect.</li></ul>' },
    { title: 'How to Deploy SafeLink', content: '<p>SafeLink is a Single Page Application (SPA) built with React + Vite. Here is how to deploy it:</p><ol class="list-decimal pl-5 space-y-2"><li><strong>Build</strong> — Run <code class="bg-gray-800 px-1.5 py-0.5 rounded text-emerald-400">npm run build</code> to generate the <code class="bg-gray-800 px-1.5 py-0.5 rounded text-emerald-400">dist/</code> folder.</li><li><strong>Static Hosting</strong> — Upload the contents of the dist/ folder to an SPA-compatible host such as Netlify, Vercel, Cloudflare Pages, or GitHub Pages.</li><li><strong>Routing</strong> — SafeLink uses hash routing (#/code), so no special server configuration is needed. Simply serve all files from the dist folder.</li><li><strong>Custom Domain</strong> — Connect your domain in your hosting settings, then enter it in Settings → Custom Domain.</li></ol><p>SafeLink can also be hosted on regular cPanel hosting — just upload the files from the dist/ folder to public_html.</p>' },
    { title: 'Tips & Tricks', content: '<p>Here are some tips to maximize your SafeLink experience:</p><ul class="list-disc pl-5 space-y-2"><li><strong>Use memorable link names</strong> — Although codes are generated automatically, you can leverage existing links effectively.</li><li><strong>Monitor clicks regularly</strong> — Use the CSV export feature to analyze link performance in detail.</li><li><strong>Use multi-domain</strong> — With multiple domains and random domain enabled, links will appear more diverse on WhatsApp and social media.</li><li><strong>Set appropriate redirect time</strong> — 5-10 seconds is enough to display the article and CTA without making visitors wait too long.</li><li><strong>Clean up old links</strong> — The auto-cleanup feature will remove old links. Configure the number of days in settings.</li><li><strong>Save database configurations</strong> — Use the "Saved Configs" feature in the Database tab to quickly save and load configurations.</li></ul>' },
  ];

  return (
    <div className="space-y-4">
      <div className="bg-gray-900 rounded-2xl p-5 border border-gray-800">
        <div className="flex items-center gap-3 mb-5">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-amber-500/10 ring-1 ring-amber-500/20">
            <IconBook className="w-5 h-5 text-amber-400" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-white">SafeLink Tutorial</h2>
            <p className="text-xs text-gray-500 mt-0.5">Panduan lengkap penggunaan SafeLink</p>
          </div>
        </div>
        <div className="divide-y divide-gray-800/50">
          {sections.map((section, i) => (
            <div key={i} className="py-3">
              <button
                onClick={() => setOpenIndex(openIndex === i ? null : i)}
                className="w-full flex items-center justify-between text-left cursor-pointer group"
              >
                <span className="text-sm text-gray-300 group-hover:text-white font-medium transition-colors">{section.title}</span>
                <svg className={`w-4 h-4 text-gray-600 transition-transform duration-200 ${openIndex === i ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
              </button>
              {openIndex === i && (
                <div className="mt-3 text-sm text-gray-400 leading-relaxed space-y-2" dangerouslySetInnerHTML={{ __html: section.content }} />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Saved Database Configs ──────────────────────────────────────────
function SavedConfigs({ toast }: { toast: ReturnType<typeof useToast>['toast'] }) {
  const [configs, setConfigs] = useState<Array<{ name: string; config: DatabaseConfig }>>([]);
  const [configName, setConfigName] = useState('');

  useEffect(() => {
    try {
      const raw = localStorage.getItem('safelink_saved_configs');
      if (raw) setConfigs(JSON.parse(raw));
    } catch { /* ignore */ }
  }, []);

  function saveConfig() {
    const name = configName.trim();
    if (!name) { toast({ title: 'Enter config name', variant: 'destructive' }); return; }
    const config = getDbConfig();
    const newConfigs = [...configs.filter(c => c.name !== name), { name, config }];
    localStorage.setItem('safelink_saved_configs', JSON.stringify(newConfigs));
    setConfigs(newConfigs);
    setConfigName('');
    toast({ title: 'Config saved!' });
  }

  function loadConfig(config: DatabaseConfig) {
    switchDatabase(config);
    toast({ title: 'Config loaded!', description: `Switched to ${config.type}` });
    window.location.reload();
  }

  function deleteConfig(name: string) {
    const newConfigs = configs.filter(c => c.name !== name);
    localStorage.setItem('safelink_saved_configs', JSON.stringify(newConfigs));
    setConfigs(newConfigs);
    toast({ title: 'Config deleted' });
  }

  return (
    <div className="bg-gray-900 rounded-2xl p-5 border border-gray-800">
      <div className="flex items-center gap-3 mb-5">
        <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-orange-500/10 ring-1 ring-orange-500/20">
          <IconDownload className="w-5 h-5 text-orange-400" />
        </div>
        <div>
          <h2 className="text-sm font-bold text-white">Saved Configs</h2>
          <p className="text-xs text-gray-500 mt-0.5">Save & load database configurations</p>
        </div>
      </div>
      <div className="flex gap-2 mb-4">
        <input type="text" value={configName} onChange={(e) => setConfigName(e.target.value)} placeholder="Config name..." className="flex-1 min-w-0 px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent placeholder-gray-600 transition-all" />
        <button onClick={saveConfig} className="px-4 py-2.5 bg-orange-500 hover:bg-orange-600 text-white text-xs font-medium rounded-xl transition-colors cursor-pointer shrink-0">Save</button>
      </div>
      {configs.length === 0 ? (
        <p className="text-xs text-gray-600 text-center py-4">No saved configs yet</p>
      ) : (
        <div className="space-y-2">
          {configs.map(c => (
            <div key={c.name} className="flex items-center justify-between gap-2 bg-gray-800/50 rounded-lg px-3 py-2.5 border border-gray-700/50">
              <div className="min-w-0">
                <div className="text-sm text-white font-medium truncate">{c.name}</div>
                <div className="text-xs text-gray-500">{c.config.type} — {c.config.supabaseUrl || c.config.firebaseUrl || c.config.jsonbinBinId || c.config.cpanelApiUrl || c.config.pockethostUrl || c.config.restdbDbName || c.config.neonEndpoint || 'configured'}</div>
              </div>
              <div className="flex gap-1.5 shrink-0">
                <button onClick={() => loadConfig(c.config)} className="px-3 py-1.5 bg-emerald-500/10 text-emerald-400 text-xs font-medium rounded-lg hover:bg-emerald-500/20 transition-colors cursor-pointer">Load</button>
                <button onClick={() => deleteConfig(c.name)} className="px-2 py-1.5 bg-red-500/10 text-red-400 text-xs rounded-lg hover:bg-red-500/20 transition-colors cursor-pointer"><IconTrash className="w-3.5 h-3.5" /></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Dashboard ───────────────────────────────────────────────────────
function Dashboard({ toast }: { toast: ReturnType<typeof useToast>['toast'] }) {
  const [activeTab, setActiveTab] = useState<Tab>('home');
  const [links, setLinks] = useState<ShortLinkData[]>([]);
  const [loading, setLoading] = useState(true);
  const [customDomain, setCustomDomain] = useState<string | undefined>(undefined);
  const [customDomains, setCustomDomains] = useState('');
  const [randomDomain, setRandomDomain] = useState(false);

  const loadLinks = useCallback(async () => {
    try {
      const data = await getDb().getAllLinks();
      setLinks(data);
    } catch (err) { console.error('Load links error:', err); }
    setLoading(false);
  }, []);

  // Load custom domain from database on mount
  useEffect(() => {
    async function loadSettings() {
      try {
        const data = await getDb().getAllSettings();
        if (data) {
          data.forEach((row) => {
            switch (row.key) {
              case 'custom_domain': setCustomDomain(row.value || undefined); break;
              case 'custom_domains': setCustomDomains(row.value); break;
              case 'random_domain': setRandomDomain(row.value === 'true'); break;
            }
          });
        }
      } catch { /* silent */ }
    }
    loadSettings();
  }, []);

  useEffect(() => { loadLinks(); }, [loadLinks]);

  const handleSettingsChange = useCallback((settings: SettingsData) => {
    setCustomDomain(settings.custom_domain || undefined);
    setCustomDomains(settings.custom_domains);
    setRandomDomain(settings.random_domain);
  }, []);

  const handleLogout = useCallback(() => {
    localStorage.removeItem('safelink_auth');
    window.location.hash = '';
    window.location.reload();
  }, []);

  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: 'home', label: 'Home', icon: <IconHome /> },
    { key: 'create', label: 'Create', icon: <IconPlus /> },
    { key: 'tutorial', label: 'Tutorial', icon: <IconBook /> },
    { key: 'settings', label: 'Settings', icon: <IconCog /> },
  ];

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex flex-col w-64 bg-gray-900/50 border-r border-gray-800 p-4 fixed top-0 bottom-0 z-30">
        <div className="flex items-center gap-2.5 px-3 py-4 mb-6">
          <div className="w-8 h-8 bg-emerald-500/20 rounded-lg flex items-center justify-center ring-1 ring-emerald-500/30"><span className="text-emerald-400"><IconLink className="w-4 h-4" /></span></div>
          <span className="text-sm font-bold text-white">SafeLink</span>
        </div>
        <nav className="flex-1 space-y-1" role="navigation" aria-label="Dashboard navigation">
          {tabs.map(tab => (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all cursor-pointer ${activeTab === tab.key ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/20' : 'text-gray-400 hover:text-white hover:bg-gray-800'}`}>
              {tab.icon} {tab.label}
            </button>
          ))}
        </nav>
        <button onClick={handleLogout} className="flex items-center gap-3 px-4 py-3 text-sm text-gray-500 hover:text-red-400 rounded-xl transition-colors cursor-pointer">
          <IconLogout /> Logout
        </button>
      </aside>

      {/* Mobile Header */}
      <header className="lg:hidden sticky top-0 z-30 bg-gray-950/90 backdrop-blur-xl border-b border-gray-800">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2"><span className="text-emerald-400"><IconLink className="w-4 h-4" /></span><span className="text-sm font-bold text-white">SafeLink</span></div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 lg:ml-64 p-4 lg:p-8 pb-24 lg:pb-8">
        {loading ? (
          <div className="flex items-center justify-center py-20"><div className="w-12 h-12 border-4 border-gray-700 border-t-emerald-500 rounded-full animate-spin" /></div>
        ) : (
          <>
            {activeTab === 'home' && <HomeTab links={links} onLoad={loadLinks} toast={toast} customDomain={customDomain} customDomains={customDomains} randomDomain={randomDomain} />}
            {activeTab === 'create' && <CreateTab onLoad={loadLinks} toast={toast} customDomain={customDomain} customDomains={customDomains} randomDomain={randomDomain} />}
            {activeTab === 'tutorial' && <TutorialTab />}
            {activeTab === 'settings' && <SettingsTab toast={toast} onSettingsChange={handleSettingsChange} />}

          </>
        )}
      </main>

      {/* Mobile Bottom Nav */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-30 bg-gray-900/95 backdrop-blur-xl border-t border-gray-800" role="navigation" aria-label="Dashboard navigation">
        <div className="flex">
          {tabs.map(tab => (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)} className={`flex-1 flex flex-col items-center gap-1 py-3 transition-colors cursor-pointer ${activeTab === tab.key ? 'text-emerald-400' : 'text-gray-500'}`}>
              {tab.icon} <span className="text-[10px] font-medium">{tab.label}</span>
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}

// ─── Home Page (minimal landing) ─────────────────────────────────────
function HomePage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950">
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-emerald-600/5 rounded-full blur-3xl" />
      </div>
      <div className="relative text-center">
        <div className="w-20 h-20 bg-emerald-500/20 rounded-2xl flex items-center justify-center mx-auto mb-6 ring-1 ring-emerald-500/30">
          <span className="text-emerald-400"><IconLink className="w-10 h-10" /></span>
        </div>
        <h1 className="text-4xl font-bold text-white mb-2">SafeLink</h1>
        <p className="text-gray-500 text-sm">Smart URL Shortener & Safelink</p>
      </div>
    </div>
  );
}

// ─── App Root ────────────────────────────────────────────────────────
export default function App() {
  const [isAuth, setIsAuth] = useState(false);
  const [ready, setReady] = useState(false);
  const [hash, setHash] = useState('');
  const [dbOk, setDbOk] = useState(false);
  const { toasts, toast, removeToast } = useToast();

  // Initialize DB config from online config file, THEN localStorage
  useEffect(() => {
    async function boot() {
      const auth = localStorage.getItem('safelink_auth');
      if (auth) setIsAuth(true);

      // Load config from /safelink-config.json first, then localStorage
      await initDbConfig();
      setDbOk(isDbConfigured());
      setReady(true);
    }
    boot();
  }, []);

  // Listen for hash changes
  useEffect(() => {
    function handleHashChange() {
      // Handle 404.html redirect: convert /?/path to hash route
      const searchPath = window.location.search.match(/^\/\?\/(.+)$/);
      if (searchPath) {
        const decoded = decodeURIComponent(searchPath[1].replace(/~and~/g, '&'));
        window.location.replace(window.location.pathname + '#' + decoded);
        return;
      }
      setHash(window.location.hash);
    }
    // Also check query string on initial load
    const searchPath = window.location.search.match(/^\/\?\/(.+)$/);
    if (searchPath) {
      const decoded = decodeURIComponent(searchPath[1].replace(/~and~/g, '&'));
      window.location.replace(window.location.pathname + '#' + decoded);
      return;
    }
    setHash(window.location.hash);
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-950">
        <div className="w-12 h-12 border-4 border-gray-700 border-t-emerald-500 rounded-full animate-spin" />
      </div>
    );
  }

  const code = hash.replace(/^#\/?/, '');

  // No hash → Show minimal HomePage
  if (hash === '' || hash === '#') {
    return (
      <>
        <HomePage />
        <ToastContainer toasts={toasts} onRemove={removeToast} />
      </>
    );
  }

  // #admin → Show login or dashboard
  if (hash === '#admin') {
    if (!isAuth) {
      return (
        <>
          <PinLogin onLogin={() => setIsAuth(true)} toast={toast} />
          <ToastContainer toasts={toasts} onRemove={removeToast} />
        </>
      );
    }
    return (
      <>
        <Dashboard toast={toast} />
        <ToastContainer toasts={toasts} onRemove={removeToast} />
      </>
    );
  }

  // Any other hash (like #CODE) → Show RedirectPage
  if (code) {
    // If DB not configured, show setup message instead of broken redirect
    if (!dbOk) {
      return (
        <div className="min-h-screen flex items-center justify-center p-4 bg-gray-950">
          <div className="text-center bg-gray-900 rounded-2xl p-10 border border-gray-800 max-w-md">
            <div className="w-16 h-16 bg-amber-500/20 rounded-full flex items-center justify-center mx-auto mb-5">
              <svg className="w-8 h-8 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" /></svg>
            </div>
            <h2 className="text-xl font-bold text-white mb-3">Database Belum Dikonfigurasi</h2>
            <p className="text-gray-500 text-sm mb-4">Short link tidak bisa diproses karena database belum diatur. Upload file <code className="bg-gray-800 px-1.5 py-0.5 rounded text-amber-400 text-xs">safelink-config.json</code> ke folder yang sama dengan index.html.</p>
          </div>
        </div>
      );
    }
    return (
      <>
        <RedirectPage code={code} toast={toast} />
        <ToastContainer toasts={toasts} onRemove={removeToast} />
      </>
    );
  }

  // Fallback to HomePage
  return (
    <>
      <HomePage />
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </>
  );
}