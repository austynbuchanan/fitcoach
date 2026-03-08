import { useState, useRef, useEffect, useCallback } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

// ─────────────────────────────────────────────────────────────────────────────
// SUPABASE CONFIG — paste your credentials here
// Get these from: supabase.com → your project → Settings → API
// ─────────────────────────────────────────────────────────────────────────────
const SUPABASE_URL = "https://djaezlsavjvsnztecpff.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRqYWV6bHNhdmp2c256dGVjcGZmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI4MTQ0MzMsImV4cCI6MjA4ODM5MDQzM30.7LwRpFzOiKnDxk4kHtdfo-oPGdXZg7ogB5wIsE1vxK4";

// ── Lightweight Supabase client (no npm needed) ───────────────────────────────
const supabase = (() => {
  const headers = { "Content-Type": "application/json", "apikey": SUPABASE_ANON_KEY, "Authorization": `Bearer ${SUPABASE_ANON_KEY}` };
  const authed = (token) => ({ ...headers, "Authorization": `Bearer ${token}` });

  const rpc = async (path, method = "GET", body = null, token = null) => {
    const res = await fetch(`${SUPABASE_URL}${path}`, {
      method, headers: token ? authed(token) : headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    return { data, error: res.ok ? null : data };
  };

  return {
    // Auth
    signUp: (email, password) => rpc("/auth/v1/signup", "POST", { email, password }),
    signIn: (email, password) => rpc("/auth/v1/token?grant_type=password", "POST", { email, password }),
    signOut: (token) => rpc("/auth/v1/logout", "POST", null, token),
    getUser: (token) => rpc("/auth/v1/user", "GET", null, token),

    // Database helpers
    from: (table) => ({
      upsert: (row, token) => rpc(`/rest/v1/${table}`, "POST", row, token, { "Prefer": "resolution=merge-duplicates,return=representation" }),
      select: (filter, token) => rpc(`/rest/v1/${table}?${filter}&select=*`, "GET", null, token),
      delete: (filter, token) => rpc(`/rest/v1/${table}?${filter}`, "DELETE", null, token),
    }),

    // Simplified upsert (merge by user_id)
    save: async (table, data, token) => {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
        method: "POST",
        headers: { ...authed(token), "Prefer": "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(data),
      });
      return res.ok;
    },

    // Load single row by user_id
    load: async (table, userId, token) => {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?user_id=eq.${userId}&select=*`, {
        headers: authed(token),
      });
      const rows = await res.json().catch(() => []);
      return Array.isArray(rows) ? rows[0] || null : null;
    },
  };
})();

// ── Auth state helpers ────────────────────────────────────────────────────────
// Session stored in memory only — profile loaded from Supabase on sign in
const getStoredSession = () => null; // no localStorage
const setStoredSession = () => {};
const setStoredProfile = () => {};


function getColors(dark = true) {
  if (dark) return {
    bg: "#0D0D0F", card: "#161618", border: "#2a2a2e",
    accent: "#FF5C00", accentDim: "#FF5C0018", accentBorder: "#FF5C0045",
    text: "#F5F5F7", muted: "#666672",
    red: "#FF2D55", orange: "#FF9F0A", blue: "#00D4FF", purple: "#BF5AF2", yellow: "#FFD60A",
    cyan: "#00F5FF", magenta: "#FF0090",
  };
  return {
    bg: "#F2F2F7", card: "#FFFFFF", border: "#E5E5EA",
    accent: "#FF5C00", accentDim: "#FF5C0012", accentBorder: "#FF5C0035",
    text: "#1C1C1E", muted: "#8E8E93",
    red: "#FF3B30", orange: "#FF9500", blue: "#007AFF", purple: "#AF52DE", yellow: "#FFCC00",
    cyan: "#32ADE6", magenta: "#FF2D55",
  };
}

// Calorie + macro calculator (Mifflin-St Jeor)
function calcNutritionGoals(profile) {
  const weight = parseFloat(profile.weight) || 185; // lbs
  const age    = parseFloat(profile.age)    || 25;
  const ft     = parseFloat(profile.heightFt) || 5;
  const inch   = parseFloat(profile.heightIn) || 10;
  const weightKg = weight * 0.453592;
  const heightCm = (ft * 12 + inch) * 2.54;
  // BMR using Mifflin-St Jeor
  const sexAdj = profile.sex === 'female' ? -161 : 5;
  const bmr = 10 * weightKg + 6.25 * heightCm - 5 * age + sexAdj;
  const activityMult = { sedentary: 1.2, light: 1.375, moderate: 1.55, very: 1.725 }[profile.activityLevel] || 1.375;
  const tdee = Math.round(bmr * activityMult);
  // Adjust for goal
  const goalAdj = { lose_fat: -500, lose_weight: -500, cut: -400, bulk: 300, gain_muscle: 250, build_muscle: 250, maintain: 0 }[profile.goal] || 0;
  const calories = Math.max(1200, tdee + goalAdj);
  // Macro split based on goal
  let proteinPct = 0.30, carbPct = 0.40, fatPct = 0.30;
  if (profile.goal === "lose_fat" || profile.goal === "cut")    { proteinPct = 0.35; carbPct = 0.35; fatPct = 0.30; }
  if (profile.goal === "build_muscle" || profile.goal === "bulk") { proteinPct = 0.30; carbPct = 0.45; fatPct = 0.25; }
  if (profile.goal === "get_stronger")                           { proteinPct = 0.30; carbPct = 0.40; fatPct = 0.30; }
  const protein = Math.round((calories * proteinPct) / 4);
  const carbs   = Math.round((calories * carbPct)    / 4);
  const fat     = Math.round((calories * fatPct)     / 9);
  return { calories, protein, carbs, fat, tdee };
}
// waterGoal is now state inside App

const FOODS = [
  { name: "Chicken Breast (100g)", cal: 165, protein: 31, carbs: 0, fat: 3.6 },
  { name: "Brown Rice (1 cup)", cal: 216, protein: 5, carbs: 45, fat: 1.8 },
  { name: "Banana", cal: 89, protein: 1.1, carbs: 23, fat: 0.3 },
  { name: "Greek Yogurt (200g)", cal: 130, protein: 17, carbs: 9, fat: 2 },
  { name: "Eggs (2 large)", cal: 156, protein: 13, carbs: 1.1, fat: 11 },
  { name: "Oatmeal (1 cup)", cal: 154, protein: 5, carbs: 28, fat: 3 },
  { name: "Salmon (100g)", cal: 208, protein: 20, carbs: 0, fat: 13 },
  { name: "Almonds (30g)", cal: 174, protein: 6, carbs: 6, fat: 15 },
  { name: "Sweet Potato", cal: 103, protein: 2, carbs: 24, fat: 0.1 },
  { name: "Avocado (half)", cal: 120, protein: 1.5, carbs: 6, fat: 11 },
  { name: "Whey Protein Shake", cal: 120, protein: 25, carbs: 3, fat: 2 },
  { name: "Broccoli (1 cup)", cal: 55, protein: 3.7, carbs: 11, fat: 0.6 },
];

const EXERCISES = [
  "Bench Press","Squat","Deadlift","Pull-ups","Overhead Press","Barbell Row",
  "Leg Press","Dumbbell Curl","Tricep Pushdown","Lat Pulldown","Hip Thrust",
  "Romanian Deadlift","Incline Press","Cable Fly","Face Pull","Calf Raise","Running",
];

const FREE_HABITS = [
  { id: "water",   label: "Drink Water",  icon: "💧" },
  { id: "sleep",   label: "8hrs Sleep",   icon: "😴" },
  { id: "steps",   label: "10k Steps",    icon: "🚶" },
];
const PRO_HABITS = [
  { id: "workout", label: "Workout",      icon: "🏋️" },
  { id: "nosugar", label: "No Sugar",     icon: "🚫" },
  { id: "vitamins",label: "Vitamins",     icon: "💊" },
];
const DEFAULT_HABITS = [...FREE_HABITS, ...PRO_HABITS];

const HABIT_ICONS = ["💧","😴","🚶","🏋️","🚫","💊","🥗","🧘","📚","☀️","🏃","🧴","🥤","🍎","🧠","💤","🚴","🤸","🛌","💆"];

const BADGES = [
  { id: "first_login",   icon: "👋", label: "Welcome",         desc: "Joined FitCoach" },
  { id: "log_3",        icon: "📝", label: "Getting Started",  desc: "Logged 3 days in a row" },
  { id: "log_7",        icon: "🔥", label: "Week Warrior",     desc: "7-day logging streak" },
  { id: "log_30",       icon: "💎", label: "Consistent",       desc: "30-day logging streak" },
  { id: "protein_goal", icon: "🥩", label: "Protein King",     desc: "Hit protein goal 5 days" },
  { id: "workout_10",   icon: "🏋️", label: "Iron Will",        desc: "Logged 10 workouts" },
  { id: "photo_first",  icon: "📸", label: "First Look",       desc: "Added first progress photo" },
  { id: "weight_down",  icon: "⚖️", label: "Trending Down",    desc: "Lost 5 lbs from starting weight" },
  { id: "habit_7",      icon: "✅", label: "Habit Hero",       desc: "7-day habit streak" },
  { id: "team_joined",  icon: "👥", label: "Team Player",      desc: "Joined or created a team" },
  { id: "meal_plan",    icon: "🥗", label: "Meal Prepper",     desc: "Generated first meal plan" },
  { id: "pro_member",   icon: "⚡", label: "Pro Member",       desc: "Upgraded to FitCoach Pro" },
];

const SEED_WEIGHTS = [
  { date: "Jan 1", weight: 195 }, { date: "Jan 8", weight: 193.5 },
  { date: "Jan 15", weight: 192 }, { date: "Jan 22", weight: 191 },
  { date: "Feb 1", weight: 189.5 }, { date: "Feb 8", weight: 188 },
  { date: "Feb 15", weight: 187.5 }, { date: "Today", weight: 186 },
];

const CONNECTED_APPS = [
  { id: "apple_health", name: "Apple Health", icon: "🍎", color: "#ff3b30", desc: "Steps, heart rate, workouts" },
  { id: "apple_fitness", name: "Apple Fitness+", icon: "🏃", color: "#ff2d55", desc: "Activity rings & workouts" },
  { id: "fitbit", name: "Fitbit", icon: "📊", color: "#00b0b9", desc: "Sleep, activity, heart rate" },
  { id: "garmin", name: "Garmin Connect", icon: "⌚", color: "#007cc3", desc: "GPS, VO2 max, training load" },
  { id: "google_fit", name: "Google Fit", icon: "🌀", color: "#4285f4", desc: "Activity & heart points" },
  { id: "myfitnesspal", name: "MyFitnessPal", icon: "🥗", color: "#0070c0", desc: "Nutrition & food database" },
  { id: "strava", name: "Strava", icon: "🚴", color: "#fc4c02", desc: "Runs, rides, activities" },
  { id: "whoop", name: "WHOOP", icon: "💪", color: "#e63333", desc: "Recovery & strain scores" },
];


// ── COACH AVATARS ────────────────────────────────────────────────────────────
const COACH_PHOTOS = {
  marcus: "https://randomuser.me/api/portraits/men/32.jpg",
  sara:   "https://randomuser.me/api/portraits/women/44.jpg",
  jake:   "https://randomuser.me/api/portraits/men/55.jpg",
  diana:  "https://randomuser.me/api/portraits/women/68.jpg",
};

const CoachAvatar = ({ coachId, size = 48, style: extraStyle = {} }) => {
  const [errored, setErrored] = useState(false);
  const initials = { marcus: "M", sara: "S", jake: "J", diana: "D" };
  const colors = { marcus: "#ff9f1c", sara: "#00b4a0", jake: "#3d9bff", diana: "#a855f7" };
  const col = colors[coachId] || "FF5C00";

  if (errored) {
    return (
      <div style={{ width: size, height: size, borderRadius: "50%", background: `${col}30`,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: size * 0.38, fontWeight: 800, color: col,
        fontFamily: "'Bebas Neue',sans-serif", ...extraStyle }}>
        {initials[coachId] || "?"}
      </div>
    );
  }

  return (
    <img
      src={COACH_PHOTOS[coachId]}
      alt={coachId}
      onError={() => setErrored(true)}
      style={{ width: size, height: size, objectFit: "cover", display: "block", borderRadius: "50%", ...extraStyle }}
    />
  );
};

// ── COACHES ───────────────────────────────────────────────────────────────────
const COACHES = [
  {
    id: "marcus",
    name: "Marcus",
    title: "Strength & Performance Coach",
    gender: "Male",
    vibe: "Motivating & Energetic",
    bg: "#ff9f1c",
    tagline: "Let's go — no excuses, just results.",
    greeting: (name) => `What's up ${name}! I'm Marcus. I'm here to push you past your limits and make sure you show up every single day. Ready to get to work?`,
    personality: "high-energy, direct, uses sports analogies, celebrates wins loudly",
  },
  {
    id: "sara",
    name: "Sara",
    title: "Holistic Wellness Coach",
    gender: "Female",
    vibe: "Calm & Supportive",
    bg: "#00b4a0",
    tagline: "Progress over perfection, always.",
    greeting: (name) => `Hi ${name}, I'm Sara. I believe real transformation happens when we work with your body, not against it. I'm here to guide you every step of the way.`,
    personality: "warm, encouraging, focuses on sustainability and mindset",
  },
  {
    id: "jake",
    name: "Jake",
    title: "Fat Loss & Nutrition Coach",
    gender: "Male",
    vibe: "Friendly & Conversational",
    bg: "#3d9bff",
    tagline: "Eat smart, move well, feel great.",
    greeting: (name) => `Hey ${name}! Jake here. I nerd out on nutrition and I love making it simple. No fad diets, no weird restrictions — just real food and real results. Let's chat!`,
    personality: "friendly, uses humor, breaks down science into simple terms",
  },
  {
    id: "diana",
    name: "Diana",
    title: "Athletic Performance Coach",
    gender: "Female",
    vibe: "Tough Love",
    bg: "#a855f7",
    tagline: "Champions are made when no one's watching.",
    greeting: (name) => `${name}. I'm Diana. I don't sugarcoat things — I tell you what you need to hear, not what you want to hear. If you're serious about results, we'll get along just fine.`,
    personality: "direct, data-driven, high standards, tough but fair",
  },
];

const GOALS = [
  { id: "lose_fat", label: "Lose Fat", icon: "🔥", desc: "Shed body fat and get lean" },
  { id: "build_muscle", label: "Build Muscle", icon: "💪", desc: "Gain strength and size" },
  { id: "get_fit", label: "Get Fit", icon: "🏃", desc: "Improve overall fitness" },
  { id: "maintain", label: "Maintain", icon: "⚖️", desc: "Stay healthy and consistent" },
  { id: "athletic", label: "Athletic Performance", icon: "🏆", desc: "Train like an athlete" },
];

const ACTIVITY_LEVELS = [
  { id: "sedentary", label: "Sedentary", desc: "Desk job, little movement" },
  { id: "light", label: "Lightly Active", desc: "1–2 workouts/week" },
  { id: "moderate", label: "Moderately Active", desc: "3–4 workouts/week" },
  { id: "very", label: "Very Active", desc: "5+ workouts/week" },
];

// ── ONBOARDING ─────────────────────────────────────────────────────────────────
function Onboarding({ onComplete }) {
  const [step, setStep] = useState(0);
  const [profile, setProfile] = useState({
    name: "", photo: null,
    age: "", heightFt: "", heightIn: "", weight: "",
    sex: "",
    goal: "", activityLevel: "",
    coachId: "",
    experience: "", medicalNotes: "",
  });
  const photoRef = useRef(null);
  const TOTAL_STEPS = 6;

  const set = (key, val) => setProfile(p => ({ ...p, [key]: val }));

  const canNext = () => {
    if (step === 0) return profile.name.trim().length > 0;
    if (step === 1) return profile.age && profile.heightFt && profile.weight;
    if (step === 2) return !!profile.goal;
    if (step === 3) return !!profile.activityLevel;
    if (step === 4) return !!profile.coachId;
    return true;
  };

  const next = () => { if (step < TOTAL_STEPS - 1) setStep(s => s + 1); else onComplete(profile); };
  const back = () => setStep(s => s - 1);

  const inputStyle = {
    width: "100%", padding: "14px 16px",
    background: "#1e1e22", border: "1.5px solid #3a3a3e",
    borderRadius: 14, color: "#F5F5F7", fontSize: 15,
    fontFamily: "inherit", outline: "none",
    transition: "border .2s",
  };

  const progress = ((step) / (TOTAL_STEPS - 1)) * 100;

  return (
    <div style={{ minHeight: "100vh", background: "#0D0D0F", color: "#F5F5F7", fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", maxWidth: 430, margin: "0 auto", display: "flex", flexDirection: "column" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        input,textarea{outline:none;font-family:inherit}button{cursor:pointer;font-family:inherit;border:none}
        @keyframes fadeUp{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
        @keyframes fadeIn{from{opacity:0}to{opacity:1}}
        .inp:focus{border-color:FF5C00!important}
        .coach-card:hover{transform:translateY(-2px)}
      `}</style>

      {/* Progress bar */}
      <div style={{ height: 3, background: "#2a2a2e", flexShrink: 0 }}>
        <div style={{ height: "100%", background: "FF5C00", width: `${progress}%`, transition: "width .4s ease", borderRadius: 2 }} />
      </div>

      {/* Header */}
      <div style={{ padding: "40px 24px 0", flexShrink: 0 }}>
        {step > 0 && (
          <button onClick={back} style={{ background: "none", color: "#888899", fontSize: 14, fontWeight: 600, marginBottom: 20, display: "flex", alignItems: "center", gap: 6, padding: 0 }}>
            ← Back
          </button>
        )}
        <div style={{ fontSize: 10, color: "FF5C00", fontWeight: 700, letterSpacing: 2.5, textTransform: "uppercase", marginBottom: 6 }}>
          Step {step + 1} of {TOTAL_STEPS}
        </div>
      </div>

      {/* Step content */}
      <div style={{ flex: 1, overflowY: "auto", padding: "16px 24px 24px", animation: "fadeUp .3s ease" }}>

        {/* STEP 0 — Name & Photo */}
        {step === 0 && (
          <div>
            <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 28, fontWeight: 800, letterSpacing: -1, marginBottom: 8 }}>
              Welcome to<br /><span style={{ color: "FF5C00" }}>FitCoachAI</span> 👋
            </div>
            <div style={{ fontSize: 14, color: "#888899", marginBottom: 32, lineHeight: 1.6 }}>
              Let's set up your personal profile. This takes about 2 minutes.
            </div>

            {/* Photo */}
            <input ref={photoRef} type="file" accept="image/*" capture="user" onChange={e => {
              const file = e.target.files[0]; if (!file) return;
              const r = new FileReader();
              r.onload = ev => set("photo", ev.target.result);
              r.readAsDataURL(file);
            }} style={{ display: "none" }} />
            <div style={{ display: "flex", justifyContent: "center", marginBottom: 28 }}>
              <div onClick={() => photoRef.current.click()} style={{ width: 96, height: 96, borderRadius: "50%", cursor: "pointer",
                background: profile.photo ? "transparent" : "#1a1a1f",
                border: "2px dashed #1c1c2e", overflow: "hidden",
                display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 4 }}>
                {profile.photo
                  ? <img src={profile.photo} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  : <>
                    <div style={{ fontSize: 28 }}>📷</div>
                    <div style={{ fontSize: 10, color: "#888899", fontWeight: 600 }}>Add Photo</div>
                  </>}
              </div>
            </div>

            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, color: "#888899", fontWeight: 600, marginBottom: 8, letterSpacing: 0.5 }}>YOUR NAME</div>
              <input className="inp" value={profile.name} onChange={e => set("name", e.target.value)}
                placeholder="First name" style={inputStyle} />
            </div>
          </div>
        )}

        {/* STEP 1 — Body Stats */}
        {step === 1 && (
          <div>
            <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 26, fontWeight: 800, letterSpacing: -1, marginBottom: 8 }}>
              Your Stats
            </div>
            <div style={{ fontSize: 14, color: "#888899", marginBottom: 28, lineHeight: 1.6 }}>
              This helps us calculate your calorie targets and track your progress accurately.
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div>
                <div style={{ fontSize: 12, color: "#888899", fontWeight: 600, marginBottom: 8, letterSpacing: 0.5 }}>BIOLOGICAL SEX</div>
                <div style={{ display: "flex", gap: 10 }}>
                  {[{id:"male",label:"Male"},{id:"female",label:"Female"}].map(s => (
                    <button key={s.id} onClick={() => set("sex", s.id)}
                      style={{ flex: 1, padding: "12px", borderRadius: 12, fontSize: 14, fontWeight: 700, border: `1.5px solid ${profile.sex === s.id ? "#FF5C00" : "#2a2a2e"}`, background: profile.sex === s.id ? "#FF5C0020" : "#1a1a1f", color: profile.sex === s.id ? "#FF5C00" : "#F5F5F7", transition: "all .15s" }}>{s.label}</button>
                  ))}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: "#888899", fontWeight: 600, marginBottom: 8, letterSpacing: 0.5 }}>AGE</div>
                <input className="inp" type="number" value={profile.age} onChange={e => set("age", e.target.value)}
                  placeholder="e.g. 28" style={inputStyle} />
              </div>
              <div>
                <div style={{ fontSize: 12, color: "#888899", fontWeight: 600, marginBottom: 8, letterSpacing: 0.5 }}>HEIGHT</div>
                <div style={{ display: "flex", gap: 10 }}>
                  <input className="inp" type="number" value={profile.heightFt} onChange={e => set("heightFt", e.target.value)}
                    placeholder="ft" style={{ ...inputStyle, flex: 1 }} />
                  <input className="inp" type="number" value={profile.heightIn} onChange={e => set("heightIn", e.target.value)}
                    placeholder="in" style={{ ...inputStyle, flex: 1 }} />
                </div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: "#888899", fontWeight: 600, marginBottom: 8, letterSpacing: 0.5 }}>CURRENT WEIGHT (LBS)</div>
                <input className="inp" type="number" value={profile.weight} onChange={e => set("weight", e.target.value)}
                  placeholder="e.g. 185" style={inputStyle} />
              </div>
            </div>
          </div>
        )}

        {/* STEP 2 — Goal */}
        {step === 2 && (
          <div>
            <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 26, fontWeight: 800, letterSpacing: -1, marginBottom: 8 }}>
              What's your goal?
            </div>
            <div style={{ fontSize: 14, color: "#888899", marginBottom: 28 }}>
              We'll personalize your experience around this.
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {GOALS.map(g => (
                <div key={g.id} onClick={() => set("goal", g.id)} style={{
                  padding: "16px 18px", borderRadius: 16, cursor: "pointer", transition: "all .2s",
                  background: profile.goal === g.id ? "FF5C0015" : "#1a1a1f",
                  border: `1.5px solid ${profile.goal === g.id ? "FF5C00" : "#2a2a2e"}`,
                  display: "flex", alignItems: "center", gap: 14,
                }}>
                  <div style={{ fontSize: 26 }}>{g.icon}</div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 15, color: profile.goal === g.id ? "FF5C00" : "#F5F5F7" }}>{g.label}</div>
                    <div style={{ fontSize: 12, color: "#888899", marginTop: 2 }}>{g.desc}</div>
                  </div>
                  {profile.goal === g.id && <div style={{ marginLeft: "auto", width: 22, height: 22, borderRadius: "50%", background: "#FF5C00", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: "#fff", fontWeight: 800 }}>✓</div>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* STEP 3 — Activity Level + Extra Info */}
        {step === 3 && (
          <div>
            <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 26, fontWeight: 800, letterSpacing: -1, marginBottom: 8 }}>
              A bit more about you
            </div>
            <div style={{ fontSize: 14, color: "#888899", marginBottom: 24 }}>The more we know, the better we can help.</div>

            <div style={{ fontSize: 12, color: "#888899", fontWeight: 600, marginBottom: 10, letterSpacing: 0.5 }}>ACTIVITY LEVEL</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 24 }}>
              {ACTIVITY_LEVELS.map(a => (
                <div key={a.id} onClick={() => set("activityLevel", a.id)} style={{
                  padding: "14px 16px", borderRadius: 14, cursor: "pointer", transition: "all .2s",
                  background: profile.activityLevel === a.id ? "FF5C0015" : "#1a1a1f",
                  border: `1.5px solid ${profile.activityLevel === a.id ? "FF5C00" : "#2a2a2e"}`,
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14, color: profile.activityLevel === a.id ? "FF5C00" : "#F5F5F7" }}>{a.label}</div>
                    <div style={{ fontSize: 12, color: "#888899", marginTop: 2 }}>{a.desc}</div>
                  </div>
                  {profile.activityLevel === a.id && <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#FF5C00", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: "#fff", fontWeight: 800 }}>✓</div>}
                </div>
              ))}
            </div>

            <div style={{ fontSize: 12, color: "#888899", fontWeight: 600, marginBottom: 8, letterSpacing: 0.5 }}>TRAINING EXPERIENCE (OPTIONAL)</div>
            <input className="inp" value={profile.experience} onChange={e => set("experience", e.target.value)}
              placeholder="e.g. 2 years lifting, ran a 5K last year..." style={{ ...inputStyle, marginBottom: 16 }} />

            <div style={{ fontSize: 12, color: "#888899", fontWeight: 600, marginBottom: 8, letterSpacing: 0.5 }}>ANY INJURIES OR MEDICAL NOTES (OPTIONAL)</div>
            <textarea className="inp" value={profile.medicalNotes} onChange={e => set("medicalNotes", e.target.value)}
              placeholder="e.g. bad left knee, lower back issues..." rows={3}
              style={{ ...inputStyle, resize: "none", lineHeight: 1.5 }} />
          </div>
        )}

        {/* STEP 4 — Choose Coach */}
        {step === 4 && (
          <div>
            <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 26, fontWeight: 800, letterSpacing: -1, marginBottom: 8 }}>
              Choose your coach
            </div>
            <div style={{ fontSize: 14, color: "#888899", marginBottom: 24 }}>
              Pick the coaching style that resonates with you most.
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {COACHES.map(coach => {
                const selected = profile.coachId === coach.id;
                return (
                  <div key={coach.id} className="coach-card" onClick={() => set("coachId", coach.id)} style={{
                    borderRadius: 18, cursor: "pointer", overflow: "hidden", transition: "all .25s",
                    border: `2px solid ${selected ? coach.bg : "#2a2a2e"}`,
                    background: selected ? `${coach.bg}12` : "#1a1a1f",
                  }}>
                    <div style={{ padding: "18px 18px 14px", display: "flex", gap: 14, alignItems: "flex-start" }}>
                      <div style={{ width: 52, height: 52, borderRadius: "50%", overflow: "hidden", border: `2px solid ${coach.bg}60`, flexShrink: 0 }}>
                        <CoachAvatar coachId={coach.id} size={52} bg={coach.bg} />
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                          <div>
                            <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 18, fontWeight: 800, color: selected ? coach.bg : "#F5F5F7" }}>{coach.name}</div>
                            <div style={{ fontSize: 11, color: "#888899", marginTop: 1 }}>{coach.title}</div>
                          </div>
                          <div style={{ fontSize: 10, color: coach.bg, fontWeight: 700, background: `${coach.bg}18`, padding: "4px 9px", borderRadius: 20, flexShrink: 0, marginLeft: 8 }}>
                            {coach.vibe}
                          </div>
                        </div>
                        <div style={{ fontSize: 13, color: "#aaaacc", marginTop: 10, fontStyle: "italic", lineHeight: 1.5 }}>
                          "{coach.tagline}"
                        </div>
                      </div>
                    </div>
                    {selected && (
                      <div style={{ background: `${coach.bg}20`, padding: "10px 18px", borderTop: `1px solid ${coach.bg}30` }}>
                        <div style={{ fontSize: 12, color: coach.bg, fontWeight: 600 }}>✓ Selected — {coach.name} will be your coach</div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* STEP 5 — All Set */}
        {step === 5 && (() => {
          const coach = COACHES.find(c => c.id === profile.coachId);
          const goal = GOALS.find(g => g.id === profile.goal);
          return (
            <div style={{ textAlign: "center", paddingTop: 20 }}>
              <div style={{ fontSize: 64, marginBottom: 16 }}>🎉</div>
              <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 28, fontWeight: 800, letterSpacing: -1, marginBottom: 10 }}>
                You're all set,<br /><span style={{ color: "FF5C00" }}>{profile.name}!</span>
              </div>
              <div style={{ fontSize: 14, color: "#888899", marginBottom: 32, lineHeight: 1.7 }}>
                Your profile is ready. {coach?.name} is excited to start working with you.
              </div>

              {/* Summary card */}
              <div style={{ background: "#1a1a1f", border: "1px solid #1c1c2e", borderRadius: 18, padding: 20, textAlign: "left", marginBottom: 28 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 18, paddingBottom: 16, borderBottom: "1px solid #1c1c2e" }}>
                  {profile.photo
                    ? <img src={profile.photo} style={{ width: 52, height: 52, borderRadius: "50%", objectFit: "cover", border: "2px solid FF5C0040" }} />
                    : <div style={{ width: 52, height: 52, borderRadius: "50%", background: "FF5C0020", border: "2px solid FF5C0040", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 }}>👤</div>}
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 17 }}>{profile.name}</div>
                    <div style={{ fontSize: 12, color: "#888899", marginTop: 2 }}>
                      {profile.age} yrs · {profile.heightFt}'{profile.heightIn}" · {profile.weight} lbs
                    </div>
                  </div>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <div style={{ fontSize: 12, color: "#888899", fontWeight: 600 }}>Goal</div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{goal?.icon} {goal?.label}</div>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ fontSize: 12, color: "#888899", fontWeight: 600 }}>Coach</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ width: 28, height: 28, borderRadius: "50%", overflow: "hidden", border: `2px solid ${coach?.bg}50` }}>
                      <CoachAvatar coachId={coach?.id} size={28} />
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{coach?.name} <span style={{ color: "#888899", fontWeight: 400 }}>· {coach?.vibe}</span></div>
                  </div>
                </div>
              </div>
            </div>
          );
        })()}
      </div>

      {/* Bottom CTA */}
      <div style={{ padding: "16px 24px 36px", flexShrink: 0 }}>
        <button onClick={next} disabled={!canNext()} style={{
          width: "100%", padding: "16px",
          background: canNext() ? "linear-gradient(135deg,#FF9F0A,#FF5C00)" : "#2a2a2e",
          color: canNext() ? "#fff" : "#55556e",
          borderRadius: 16, fontSize: 16, fontWeight: 700,
          transition: "all .2s", border: "none",
        }}>
          {step === TOTAL_STEPS - 1 ? "Let's Go! 🚀" : "Continue →"}
        </button>
      </div>
    </div>
  );
}

function getAIReply(msg, coach, userName) {
  const m = msg.toLowerCase();
  const name = userName || "there";

  // Coach-flavored response sets
  const responses = {
    marcus: {
      nutrition: `Fuel matters, ${name}! 🔥 Here's the deal — hit your protein first, every meal. Aim for 1g per lb of bodyweight. Rice, chicken, eggs. Keep it simple, keep it consistent. No fancy diets. What did you eat today?`,
      workout: `That's what I'm talking about! 💪 You want results? Progressive overload is the name of the game. Add weight or reps every single week. Your muscles only grow when they're forced to. Don't let them get comfortable. What's your lift today?`,
      fat: `Fat loss is simple, not easy. Eat less than you burn. Period. 500 cal deficit, hit your protein, lift heavy to keep your muscle. The scale WILL move. Trust the process and stop second-guessing. You in?`,
      sleep: `Yeah I know — sleep isn't as exciting as training. But here's the truth: 7–9 hours or your gains suffer. Period. Growth hormone, recovery, cortisol — all tied to sleep. Protect it like it's a workout. Got it?`,
      plateau: `Plateau? Good — your body adapted. That means you made progress. Now we break through. Change your rep scheme, add a drop set, dial in nutrition. Your body thinks it's safe. Let's remind it it's not. 💥`,
      default: `Let's get to work, ${name}! 💪 Ask me anything — nutrition, training, recovery. I'm here to push you past what you think your limits are.`,
    },
    sara: {
      nutrition: `Hey ${name}! Nutrition doesn't have to be complicated. 🌿 Focus on whole foods most of the time — colorful veggies, quality protein, good fats. And please, don't skip meals. Your body needs consistent fuel. How are you feeling energy-wise lately?`,
      workout: `Movement is medicine, ${name}. 🌸 Find what you enjoy and build from there. Consistency over intensity — 3 solid sessions a week beats 6 burned-out ones. How's your body feeling after workouts lately?`,
      fat: `Real, lasting fat loss comes from sustainable habits — not crash diets. A small calorie deficit, protein at every meal, and patience. Your body is doing its best. Let's work with it, not against it. 💚`,
      sleep: `Sleep is honestly the most underrated health tool we have. 😴 7–9 hours, cool room, no screens before bed. Your body repairs, regulates hormones, and resets mentally. How's your sleep been lately?`,
      plateau: `Plateaus are completely normal, ${name} — please don't be discouraged. 🌿 Your body is adapting, which is actually progress. We might need to tweak calories slightly, change up your workouts, or just give it a bit more time. How long has it been stalled?`,
      default: `I'm here for you, ${name}! 🌿 Whether it's nutrition, movement, sleep or mindset — let's talk through it together. What's on your mind?`,
    },
    jake: {
      nutrition: `Oh man, nutrition is my jam! 🥗 Okay real talk — protein is king. Get 0.8–1g per lb of bodyweight and honestly everything else falls into place. Chicken, fish, Greek yogurt, eggs — all great. What's your current diet looking like?`,
      workout: `Dude, training is SO good for you beyond just looks. 💪 Three days a week of lifting, sprinkle in some cardio, and you're golden. Compound movements first — squat, deadlift, press, row. Simple and effective. What are you currently doing?`,
      fat: `Okay so fat loss — here's the secret nobody talks about: it's mostly about what you eat, not cardio. Get in a small deficit (like 300–400 cal), eat lots of protein, and stay patient. The cardio is a bonus. Easy enough, right?`,
      sleep: `Bro, sleep is SO underrated for fat loss and muscle gain. Like genuinely. Poor sleep = more hunger hormones = harder to stick to your diet. 7–8 hours and your results improve without changing anything else. Worth it, right?`,
      plateau: `Ugh, plateaus are the worst but super common! Usually it means your metabolism adapted. Try a diet break for a week at maintenance calories — it actually helps reset things. Or bump cardio slightly. What's your current setup?`,
      default: `Haha okay so what do you wanna know? 😄 I could talk nutrition and fitness all day. Hit me with your question and let's figure it out together, ${name}!`,
    },
    diana: {
      nutrition: `Nutrition is straightforward, ${name}. Calories in, calories out — with protein as your priority. 1g per pound of bodyweight, every day. No excuses, no skipping meals. Are you tracking? If not, start today.`,
      workout: `Results require effort. Three to four sessions per week, progressive overload, compound movements. If you're not tracking your lifts, you're guessing. Log everything. What's your current training split?`,
      fat: `Fat loss: caloric deficit of 400–500 calories, 1g protein per lb of bodyweight, strength training to preserve muscle. That's it. Execute consistently for 12 weeks and you'll see results. Are you ready to actually commit?`,
      sleep: `Seven to nine hours. Non-negotiable. Sleep is when your body repairs and your hormones reset. Training hard and sleeping poorly is like filling a bathtub with the drain open. Fix the basics first.`,
      plateau: `Plateaus happen when you stop challenging your body. Audit your training — are you actually progressing week to week? Audit your nutrition — are you actually in a deficit? The answer is usually in the data. Let's diagnose it.`,
      default: `${name}. I'm here to help you get results — real ones. Ask me what you need to know and I'll give you a straight answer. What are we working on?`,
    },
  };

  const coachId = coach?.id || "marcus";
  const r = responses[coachId] || responses.marcus;

  if (m.includes("calorie") || m.includes("food") || m.includes("eat") || m.includes("nutrition") || m.includes("diet") || m.includes("meal")) return r.nutrition;
  if (m.includes("workout") || m.includes("exercise") || m.includes("train") || m.includes("lift") || m.includes("gym")) return r.workout;
  if (m.includes("weight") || m.includes("lose") || m.includes("fat") || m.includes("cut") || m.includes("lean")) return r.fat;
  if (m.includes("sleep") || m.includes("rest") || m.includes("recover") || m.includes("tired")) return r.sleep;
  if (m.includes("plateau") || m.includes("stuck") || m.includes("stall") || m.includes("progress")) return r.plateau;
  return r.default;
}

const todayLabel = () => new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" });

// ── SECTION PILL (sub-nav within a tab) ──────────────────────────────────────
function SubNav({ options, active, onChange, C }) {
  return (
    <div style={{ display: "flex", gap: 6, padding: "14px 18px 0", overflowX: "auto" }}>
      {options.map(o => (
        <button key={o.id} onClick={() => onChange(o.id)}
          style={{
            flexShrink: 0, padding: "7px 18px", borderRadius: 24, fontSize: 11, fontWeight: 800,
            letterSpacing: 0.4, textTransform: "uppercase",
            border: `none`,
            background: active === o.id ? C.accent : C.border,
            color: active === o.id ? (C.bg === "#0D0D0F" ? "#fff" : "#fff") : C.muted,
            transition: "all .2s", cursor: "pointer",
            boxShadow: active === o.id ? `0 3px 14px ${C.accent}55` : "none",
            transform: active === o.id ? "scale(1.03)" : "scale(1)",
          }}>{o.label}</button>
      ))}
    </div>
  );
}


// BARCODE HELPERS — uncomment when deploying to a real hosted environment
// // ── BARCODE HELPER ────────────────────────────────────────────────────────────
// async function scanBarcodeFromFile(file) {
//   // Try native BarcodeDetector first (Chrome/Android)
//   if ("BarcodeDetector" in window) {
//     try {
//       const bd = new window.BarcodeDetector({ formats: ["ean_13","ean_8","upc_a","upc_e","code_128","code_39","itf","qr_code"] });
//       const bitmap = await createImageBitmap(file);
//       const results = await bd.detect(bitmap);
//       if (results.length > 0) return results[0].rawValue;
//     } catch(e) {}
//   }
//   // Fallback: draw to canvas and use quagga2
//   return new Promise((resolve) => {
//     const url = URL.createObjectURL(file);
//     const img = new Image();
//     img.onload = () => {
//       const canvas = document.createElement("canvas");
//       canvas.width = img.width;
//       canvas.height = img.height;
//       canvas.getContext("2d").drawImage(img, 0, 0);
//       URL.revokeObjectURL(url);
//       // Use Quagga2 via CDN
//       const script = document.createElement("script");
//       script.src = "https://cdn.jsdelivr.net/npm/quagga2@0.7.4/dist/quagga.min.js";
//       script.onload = () => {
//         window.Quagga.decodeSingle({
//           src: canvas.toDataURL(),
//           numOfWorkers: 0,
//           decoder: { readers: ["ean_reader","ean_8_reader","upc_reader","upc_e_reader","code_128_reader"] },
//           locate: true,
//         }, (result) => {
//           if (result?.codeResult?.code) resolve(result.codeResult.code);
//           else resolve(null);
//         });
//       };
//       script.onerror = () => resolve(null);
//       if (!document.querySelector('script[src*="quagga"]')) {
//         document.head.appendChild(script);
//       } else if (window.Quagga) {
//         window.Quagga.decodeSingle({
//           src: canvas.toDataURL(),
//           numOfWorkers: 0,
//           decoder: { readers: ["ean_reader","ean_8_reader","upc_reader","upc_e_reader","code_128_reader"] },
//           locate: true,
//         }, (result) => {
//           if (result?.codeResult?.code) resolve(result.codeResult.code);
//           else resolve(null);
//         });
//       } else {
//         document.head.appendChild(script);
//       }
//     };
//     img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
//     img.src = url;
//   });
// }
//
// async function lookupBarcode(barcode) {
//   const raw = barcode.replace(/\D/g, "").trim();
//   const candidates = new Set([raw]);
//   if (raw.length === 12) candidates.add("0" + raw);
//   if (raw.length === 13 && raw.startsWith("0")) candidates.add(raw.slice(1));
//
//   function parseNutriments(n, p) {
//     const cal     = n["energy-kcal_serving"] ?? n["energy-kcal_100g"] ?? n["energy-kcal"] ?? 0;
//     const protein = n["proteins_serving"]     ?? n["proteins_100g"]     ?? n["proteins"]     ?? 0;
//     const carbs   = n["carbohydrates_serving"]?? n["carbohydrates_100g"]?? n["carbohydrates"]?? 0;
//     const fat     = n["fat_serving"]           ?? n["fat_100g"]           ?? n["fat"]           ?? 0;
//     return {
//       name:    p.product_name_en || p.product_name || p.abbreviated_product_name || "Unknown Product",
//       serving: p.serving_size || p.quantity || "per serving",
//       cal:     String(Math.round(cal)),
//       protein: String(Math.round(protein * 10) / 10),
//       carbs:   String(Math.round(carbs   * 10) / 10),
//       fat:     String(Math.round(fat     * 10) / 10),
//     };
//   }
//
//   // Try all candidate codes across multiple OFF endpoints
//   const endpoints = [
//     code => `https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=product_name,product_name_en,serving_size,quantity,nutriments`,
//     code => `https://world.openfoodfacts.org/product/${code}.json`,
//     code => `https://off:off@world.openfoodfacts.net/api/v2/product/${code}.json`,
//   ];
//
//   for (const code of candidates) {
//     for (const buildUrl of endpoints) {
//       try {
//         const resp = await fetch(buildUrl(code), { cache: "no-store" });
//         if (!resp.ok) continue;
//         const data = await resp.json();
//         if (data.status === 1 && data.product) {
//           const result = parseNutriments(data.product.nutriments || {}, data.product);
//           return { ...result, barcode: code };
//         }
//       } catch(e) {}
//     }
//   }
//
//   // Last resort: Open Beauty Facts / Open Products Facts
//   for (const code of candidates) {
//     try {
//       const resp = await fetch(`https://world.openproductsfacts.org/api/v2/product/${code}.json`);
//       if (resp.ok) {
//         const data = await resp.json();
//         if (data.status === 1 && data.product) {
//           const result = parseNutriments(data.product.nutriments || {}, data.product);
//           return { ...result, barcode: code };
//         }
//       }
//     } catch(e) {}
//   }
//
//   return null;
// }
//

export default function FitCoach() {
  // DEV_MODE: set to false before shipping / when Supabase is connected
  const DEV_MODE = false;
  const DEV_PROFILE = { name: "Austyn", photo: null, age: "28", heightFt: "5", heightIn: "10", weight: "185", sex: "male", goal: "lose_fat", activityLevel: "moderate", coachId: "marcus", experience: "", medicalNotes: "" };

  const [session, setSession] = useState(DEV_MODE ? { access_token: "dev", user: { id: "dev-user" } } : null);
  const [profile, setProfile] = useState(DEV_MODE ? DEV_PROFILE : null);
  const [authMode, setAuthMode] = useState("login"); // "login" | "signup"


  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [syncStatus, setSyncStatus] = useState("idle"); // "idle"|"saving"|"saved"|"error"

  const isConfigured = SUPABASE_URL !== "YOUR_SUPABASE_URL";

  const handleAuth = async (e) => {
    e?.preventDefault();
    setAuthLoading(true); setAuthError("");
    try {
      const { data, error } = authMode === "signup"
        ? await supabase.signUp(authEmail, authPassword)
        : await supabase.signIn(authEmail, authPassword);

      if (error) {
        setAuthError(error.message || error.error_description || "Something went wrong");
        setAuthLoading(false);
        return;
      }

      const token = data?.access_token || data?.session?.access_token;
      const user  = data?.user || data?.session?.user;

      if (!token) {
        setAuthError("Sign in failed — please check your email and password");
        setAuthLoading(false);
        return;
      }

      const sess = { access_token: token, user: { id: user?.id, email: user?.email || authEmail } };
      setSession(sess);
      // Load profile from Supabase immediately after sign in
      const savedProfile = await supabase.load("fc_profiles", user?.id, token);
      if (savedProfile?.data) {
        setProfile(JSON.parse(savedProfile.data));
      }
    } catch (err) {
      setAuthError("Network error — please try again");
    }
    setAuthLoading(false);
  };

  const handleSignOut = () => {
    if (session?.access_token) supabase.signOut(session.access_token);
    setSession(null);
    setProfile(null);
  };

  // Show auth wall if Supabase is configured and not logged in
  if (isConfigured && !session) {
    return (
      <div style={{ minHeight: "100vh", background: "#0D0D0F", color: "#F5F5F7", fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <style>{`@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Plus+Jakarta+Sans:wght@400;600;700;800&display=swap'); *{box-sizing:border-box;margin:0;padding:0} input{outline:none;font-family:inherit} button{cursor:pointer;font-family:inherit;border:none}`}</style>
        <div style={{ width: "100%", maxWidth: 380 }}>
          {/* Logo */}
          <div style={{ textAlign: "center", marginBottom: 40 }}>
            <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 52, letterSpacing: 3, background: "linear-gradient(135deg,#FF9F0A,#FF5C00)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>FITCOACH</div>
            <div style={{ fontSize: 13, color: "#666672", marginTop: -4 }}>Your AI-powered fitness companion</div>
          </div>

          {/* Toggle */}
          <div style={{ display: "flex", background: "#161618", borderRadius: 14, padding: 4, marginBottom: 24, border: "1px solid #2a2a2e" }}>
            {["login", "signup"].map(m => (
              <button key={m} onClick={() => { setAuthMode(m); setAuthError(""); }}
                style={{ flex: 1, padding: "10px", borderRadius: 11, fontSize: 13, fontWeight: 700, background: authMode === m ? "#FF5C00" : "transparent", color: authMode === m ? "#fff" : "#666672", transition: "all .2s" }}>
                {m === "login" ? "Sign In" : "Create Account"}
              </button>
            ))}
          </div>

          {/* Form */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 16 }}>
            <input type="email" value={authEmail} onChange={e => setAuthEmail(e.target.value)}
              placeholder="Email address" onKeyDown={e => e.key === "Enter" && handleAuth()}
              style={{ padding: "14px 16px", background: "#161618", border: "1px solid #2a2a2e", borderRadius: 12, color: "#F5F5F7", fontSize: 15 }} />
            <input type="password" value={authPassword} onChange={e => setAuthPassword(e.target.value)}
              placeholder="Password" onKeyDown={e => e.key === "Enter" && handleAuth()}
              style={{ padding: "14px 16px", background: "#161618", border: "1px solid #2a2a2e", borderRadius: 12, color: "#F5F5F7", fontSize: 15 }} />
          </div>

          {authError && <div style={{ color: "#FF2D55", fontSize: 12, marginBottom: 12, textAlign: "center" }}>{authError}</div>}

          <button onClick={handleAuth} disabled={authLoading || !authEmail || !authPassword}
            style={{ width: "100%", padding: "15px", background: authEmail && authPassword ? "linear-gradient(135deg,#FF9F0A,#FF5C00)" : "#2a2a2e", color: authEmail && authPassword ? "#fff" : "#666672", borderRadius: 13, fontSize: 15, fontWeight: 800, transition: "all .2s" }}>
            {authLoading ? "..." : authMode === "login" ? "Sign In →" : "Create Account →"}
          </button>

          <div style={{ textAlign: "center", marginTop: 20, fontSize: 11, color: "#666672" }}>
            Secure login powered by Supabase
          </div>
        </div>
      </div>
    );
  }

  if (!profile) return <Onboarding onComplete={setProfile} />;

  return <App profile={profile} onProfileChange={setProfile} session={session} onSignOut={handleSignOut} syncStatus={syncStatus} setSyncStatus={setSyncStatus} />;
}

function App({ profile, onProfileChange, session, onSignOut, syncStatus, setSyncStatus }) {
  const [darkMode, setDarkMode] = useState(true);
  const C = getColors(darkMode);
  const userId = session?.user?.id;
  const token = session?.access_token;
  const isDev = userId === "dev-user";

  // ── Auto-save helper: debounced save to Supabase ──────────────────
  const saveRef = useRef({});
  const syncToSupabase = useCallback(async (table, data) => {
    if (isDev || !userId || !token) return;
    setSyncStatus("saving");
    const ok = await supabase.save(table, { user_id: userId, ...data }, token);
    setSyncStatus(ok ? "saved" : "error");
    setTimeout(() => setSyncStatus("idle"), 2000);
  }, [userId, token, isDev]);

  // ── Load all user data on mount ───────────────────────────────────
  useEffect(() => {
    if (isDev || !userId || !token) return;
    (async () => {
      // Load profile
      const p = await supabase.load("fc_profiles", userId, token);
      if (p) onProfileChange({ ...profile, ...JSON.parse(p.data || "{}") });
      // Load app data
      const d = await supabase.load("fc_appdata", userId, token);
      if (d) {
        const saved = JSON.parse(d.data || "{}");
        if (saved.weightLog)    setWeightLog(saved.weightLog);
        if (saved.habits)       setHabits(saved.habits);
        if (saved.habitLog)     setHabitLog(saved.habitLog);
        if (saved.customFoods)  setCustomFoods(saved.customFoods);
        if (saved.measurements) setMeasurements(saved.measurements);
        if (saved.waterGoal)    setWaterGoal(saved.waterGoal);
        if (saved.goalWeight)   setGoalWeight(saved.goalWeight);
        if (saved.isPro)        setIsPro(saved.isPro);
        if (saved.mealPlan)     setMealPlan(saved.mealPlan);
        if (saved.workoutPlan)  setWorkoutPlan(saved.workoutPlan);
        if (saved.darkMode !== undefined) setDarkMode(saved.darkMode);
      }
      // Load food log (today only)
      const f = await supabase.load("fc_foodlog", userId, token);
      if (f) setFoodLog(JSON.parse(f.data || "[]"));
    })();
  }, [userId]);


  const coach = COACHES.find(c => c.id === profile.coachId) || COACHES[0];
  const nutritionGoals = calcNutritionGoals(profile);
  const CALORIE_GOAL = nutritionGoals.calories;
  const PROTEIN_GOAL = nutritionGoals.protein;
  const CARBS_GOAL   = nutritionGoals.carbs;
  const FAT_GOAL     = nutritionGoals.fat;
  const [tab, setTab] = useState("home");
  const [isPro, setIsPro] = useState(false);
  useEffect(() => {
    if (isPro) {
      setHabits(current => {
        const existingIds = current.map(h => h.id);
        const toAdd = PRO_HABITS.filter(h => !existingIds.includes(h.id));
        return toAdd.length > 0 ? [...current, ...toAdd] : current;
      });
    }
  }, [isPro]);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [habits, setHabits] = useState(FREE_HABITS);
  const [showHabitManager, setShowHabitManager] = useState(false);
  const [newHabitLabel, setNewHabitLabel] = useState("");
  const [newHabitIcon, setNewHabitIcon] = useState("✅");
  // Measurements
  const [measurements, setMeasurements] = useState({ waist: "", chest: "", hips: "", arms: "", thighs: "", neck: "" });
  const [measureLog, setMeasureLog] = useState([]);
  // Achievements
  const [unlockedBadges, setUnlockedBadges] = useState(["first_login"]);
  // Meal plan
  const [mealPlan, setMealPlan] = useState(null);
  const [mealPlanLoading, setMealPlanLoading] = useState(false);
  const [mealPrefs, setMealPrefs] = useState({ allergies: "", avoid: "", diet: "", goal: "" });
  const [mealDay, setMealDay] = useState(0); // selected day index 0-6
  const [showShoppingList, setShowShoppingList] = useState(false);
  // Workout plan
  const [workoutPlan, setWorkoutPlan] = useState(null);
  const [workoutPlanLoading, setWorkoutPlanLoading] = useState(false);
  const [workoutPrefs, setWorkoutPrefs] = useState({ days: "4", intensity: "moderate", goal: "", equipment: "full_gym" });
  // Notifications
  const [notifPerms, setNotifPerms] = useState(false);
  const [notifSettings, setNotifSettings] = useState({ meals: true, workout: true, water: true, checkin: true });
  const [showNotifSetup, setShowNotifSetup] = useState(false);
  // Profile editing
  const [showProfile, setShowProfile] = useState(false);
  const [editProfile, setEditProfile] = useState(null);
  const profilePhotoRef = useRef(null);
  // Team
  const [team, setTeam] = useState(null); // {name, code, members:[]}
  const [showTeam, setShowTeam] = useState(false);
  const [teamInput, setTeamInput] = useState("");
  const [teamTab, setTeamTab] = useState("view"); // view | create | join
  const [shareSettings, setShareSettings] = useState({ weight: true, workouts: true, streak: true, calories: true });

  // Sub-nav state
  const [trainSub, setTrainSub] = useState("workout");
  const [trackSub, setTrackSub] = useState("calories");

  // Home
  const [water, setWater] = useState(0);
  const [waterGoal, setWaterGoal] = useState(64); // oz
  const [goalWeight, setGoalWeight] = useState("");
  const [editingWaterGoal, setEditingWaterGoal] = useState(false);
  const [habitLog, setHabitLog] = useState({});

  // Calories
  const [foodLog, setFoodLog] = useState([]);
  const [foodSearch, setFoodSearch] = useState("");
  const [showFoodSearch, setShowFoodSearch] = useState(false);
  const [favorites, setFavorites] = useState([]);
  const [customFoods, setCustomFoods] = useState([]);
  const [foodTab, setFoodTab] = useState("search"); // search | favorites | create | scan
  const [newFood, setNewFood] = useState({ name: "", cal: "", protein: "", carbs: "", fat: "" });
  const [servingPicker, setServingPicker] = useState(null);
  const [loggedMealItems, setLoggedMealItems] = useState(new Set()); // { food, qty, unit }
  const SERVING_UNITS = ["g", "oz", "cup", "tbsp", "tsp", "piece", "slice", "serving"];
  const UNIT_TO_G = { g: 1, oz: 28.35, cup: 240, tbsp: 15, tsp: 5, piece: 100, slice: 30, serving: 100 };
  const [favSearch, setFavSearch] = useState("");
  // AI photo scan state
  const [scanImage, setScanImage] = useState(null);
  const [scanLoading, setScanLoading] = useState(false);
  const [scanResults, setScanResults] = useState([]); // [{name, confirmed, grams, cal, protein, carbs, fat, estimating}]
  const scanFileRef = useRef(null);
  // itemLabelScanRef / itemLabelCallback — re-enable with barcode scan feature
  // Barcode state
  // Barcode lookup state — re-enable when app is hosted (needs real network)
  // const [barcodeLoading, setBarcodeLoading] = useState(false);
  // const [barcodeResult, setBarcodeResult] = useState(null);
  // const [barcodeInput, setBarcodeInput] = useState("");
  // const barcodeFileRef = useRef(null);

  // Weight
  const [weightLog, setWeightLog] = useState([{ date: "Start · " + new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" }), weight: parseFloat(profile.weight) || 185 }]);
  const [weightInput, setWeightInput] = useState("");
  const [editingStart, setEditingStart] = useState(false);
  const [startInput, setStartInput] = useState("");

  // Workout
  const [workouts, setWorkouts] = useState([]);
  const [activeWorkout, setActiveWorkout] = useState(null);
  const [exSearch, setExSearch] = useState("");

  // Coach
  const [messages, setMessages] = useState([
    { role: "ai", text: coach.greeting(profile.name) }
  ]);
  const [chatInput, setChatInput] = useState("");
  const [typing, setTyping] = useState(false);
  const chatEndRef = useRef(null);
  const FREE_MSG_LIMIT = 10;
  const [dailyMsgCount, setDailyMsgCount] = useState(0); // resets daily in real app

  // Photos
  const [photos, setPhotos] = useState([]); // [{date, front, side}]
  // ── Auto-save triggers ────────────────────────────────────────────
  // Save profile whenever it changes
  useEffect(() => {
    if (isDev || !userId) return;
    const t = setTimeout(() => syncToSupabase("fc_profiles", { data: JSON.stringify(profile) }), 800);
    return () => clearTimeout(t);
  }, [profile]);

  // Save app data bundle (debounced)
  const appDataBundle = JSON.stringify({ weightLog, habits, habitLog, customFoods, measurements, waterGoal, goalWeight, isPro, mealPlan, workoutPlan, darkMode });
  useEffect(() => {
    if (isDev || !userId) return;
    const t = setTimeout(() => syncToSupabase("fc_appdata", { data: appDataBundle }), 1200);
    return () => clearTimeout(t);
  }, [appDataBundle]);

  // Save food log
  useEffect(() => {
    if (isDev || !userId) return;
    const t = setTimeout(() => syncToSupabase("fc_foodlog", { data: JSON.stringify(foodLog) }), 800);
    return () => clearTimeout(t);
  }, [foodLog]);



  const [compareView, setCompareView] = useState("front"); // "front" | "side"
  const [beforePhotoIndex, setBeforePhotoIndex] = useState(null); // null = use oldest
  const fileRef = useRef(null);
  const [pendingShot, setPendingShot] = useState(null); // 'front' | 'side'
  const [draftEntry, setDraftEntry] = useState(null); // {date, front, side}

  // Connect
  const [connected, setConnected] = useState({ apple_health: true });
  const [connectingId, setConnectingId] = useState(null);

  const todayStr = todayLabel();

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, typing]);

  const totalCal = foodLog.reduce((s, f) => s + f.cal, 0);
  const totalProtein = foodLog.reduce((s, f) => s + f.protein, 0);
  const totalCarbs = foodLog.reduce((s, f) => s + f.carbs, 0);
  const totalFat = foodLog.reduce((s, f) => s + f.fat, 0);
  const calPct = Math.min((totalCal / CALORIE_GOAL) * 100, 100);
  const circ = 2 * Math.PI * 52;

  const todayHabits = habitLog[todayStr] || {};
  const habitsDone = Object.values(todayHabits).filter(Boolean).length;

  const habitStreak = (() => {
    let streak = 0;
    const keys = Object.keys(habitLog).sort();
    for (let i = keys.length - 1; i >= 0; i--) {
      if (Object.values(habitLog[keys[i]] || {}).filter(Boolean).length >= Math.min(3, habits.length)) streak++;
      else break;
    }
    if (streak >= 7) unlockBadge("habit_7");
    return streak;
  })();

  const sendMessage = async () => {
    if (!chatInput.trim()) return;
    if (!isPro && dailyMsgCount >= FREE_MSG_LIMIT) { setShowUpgrade(true); return; }
    const txt = chatInput.trim();
    setMessages(p => [...p, { role: "user", text: txt }]);
    setChatInput("");
    setTyping(true);
    if (!isPro) setDailyMsgCount(n => n + 1);
    try {
      // Build context summary for coach memory
      const latestWeight = weightLog.length ? weightLog[weightLog.length - 1].weight : null;
      const startWeight  = weightLog.length ? weightLog[0].weight : null;
      const weightDiff   = latestWeight && startWeight ? (latestWeight - startWeight).toFixed(1) : null;
      const contextStr = `
User: ${profile.name}, Age: ${profile.age}, Goal: ${GOALS.find(g=>g.id===profile.goal)?.label || profile.goal}.
Current weight: ${latestWeight || profile.weight} lbs${weightDiff ? ` (${weightDiff > 0 ? "+" : ""}${weightDiff} lbs since start)` : ""}.
Daily calories: ${CALORIE_GOAL} kcal target. Today logged: ${totalCal} kcal.
Habit streak: ${habitStreak} days. Habits done today: ${habitsDone}/${habits.length}.
Water today: ${water} oz / ${waterGoal} oz.
Workout logs: ${weightLog.length} total entries.
      `.trim();
      const systemPrompt = `You are ${coach.name}, a fitness coach. ${coach.title}. Your style: ${coach.vibe}. Be concise, warm, and specific. Always use the user's actual data when relevant. Never give generic advice when you have real numbers to reference.

User context:
${contextStr}`;
      // Build conversation history for the API
      const apiMessages = messages.slice(-8).map(m => ({
        role: m.role === "ai" ? "assistant" : "user",
        content: m.text
      }));
      apiMessages.push({ role: "user", content: txt });
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 300,
          system: systemPrompt, messages: apiMessages })
      });
      const data = await resp.json();
      if (data.error) throw new Error(data.error.message);
      const reply = data.content?.map(c => c.text || "").join("") || "Sorry, I couldn't respond right now.";
      setMessages(p => [...p, { role: "ai", text: reply }]);
    } catch(e) {
      // Fallback to local reply
      setMessages(p => [...p, { role: "ai", text: getAIReply(txt, coach, profile.name) }]);
    }
    setTyping(false);
  };

  // ── Badge unlock helper ───────────────────────────────────────────────────
  const unlockBadge = (id) => setUnlockedBadges(p => p.includes(id) ? p : [...p, id]);

  const toggleHabit = (hid) => {
    setHabitLog(prev => ({
      ...prev,
      [todayStr]: { ...(prev[todayStr] || {}), [hid]: !(prev[todayStr] || {})[hid] }
    }));
  };

  const updateSet = (ei, si, field, val) => {
    setActiveWorkout(w => ({
      ...w,
      exercises: w.exercises.map((ex, i) =>
        i !== ei ? ex : { ...ex, sets: ex.sets.map((s, j) => j !== si ? s : { ...s, [field]: val }) }
      )
    }));
  };

  const connectApp = (id) => {
    setConnectingId(id);
    setTimeout(() => { setConnected(p => ({ ...p, [id]: !p[id] })); setConnectingId(null); }, 1400);
  };

  const TABS = [
    { id: "home",  icon: "⚡", label: "Home"  },
    { id: "train", icon: "🏋️", label: "Train" },
    { id: "track", icon: "📊", label: "Track" },
    { id: "coach", icon: "🤖", label: "Coach" },
  ];

  return (
    <div style={{ minHeight: "100vh", background: C.bg, transition: "background .3s", color: C.text, fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", maxWidth: 430, margin: "0 auto", minHeight: "100vh" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}::-webkit-scrollbar{width:0}
        input,textarea,select{outline:none;font-family:inherit}button{cursor:pointer;font-family:inherit;border:none}
        @keyframes fadeUp{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
        @keyframes fadeIn{from{opacity:0}to{opacity:1}}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes popIn{0%{transform:scale(.85);opacity:0}70%{transform:scale(1.06)}100%{transform:scale(1);opacity:1}}
        @keyframes glow{0%,100%{box-shadow:0 0 0 0 #FF5C0030}50%{box-shadow:0 0 24px 6px #FF5C0045}}
        @keyframes shimmer{0%{background-position:-200% center}100%{background-position:200% center}}
        .rhov:hover{background:#FF5C0010!important}.bact:active{transform:scale(.94);opacity:.85}
        .card-shadow{box-shadow:0 4px 20px rgba(0,0,0,.28),0 1px 4px rgba(0,0,0,.18)}
        .card-shadow-light{box-shadow:0 4px 16px rgba(0,0,0,.08),0 1px 3px rgba(0,0,0,.06)}
      `}</style>

      {/* HEADER */}
      <div style={{ padding: "52px 18px 14px", background: darkMode ? "linear-gradient(160deg,#1a1008 0%,#0D0D0F 60%)" : "linear-gradient(160deg,#fff3ec 0%,#F2F2F7 60%)", borderBottom: `1px solid ${C.border}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          {/* Left: avatar + name */}
          <div style={{ display: "flex", alignItems: "center", gap: 11, cursor: "pointer" }}
            onClick={() => { setEditProfile({...profile}); setShowProfile(true); }}>
            <div style={{ position: "relative" }}>
              {profile.photo
                ? <img src={profile.photo} style={{ width: 44, height: 44, borderRadius: 14, objectFit: "cover", border: `2px solid ${C.accent}` }} />
                : <div style={{ width: 44, height: 44, borderRadius: 14, background: `linear-gradient(135deg,${C.accent},${C.magenta || "#FF0090"})`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>💪</div>
              }
              {isPro && <div style={{ position: "absolute", bottom: -4, right: -4, background: "#FF9F0A", borderRadius: 6, fontSize: 8, fontWeight: 800, color: "#000", padding: "1px 4px", border: `1px solid ${C.bg}` }}>PRO</div>}
            </div>
            <div>
              <div style={{ fontSize: 10, color: C.accent, fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 1 }}>Let's go</div>
              <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 24, letterSpacing: 1, color: C.text, lineHeight: 1 }}>{profile.name}</div>
            </div>
          </div>
          {/* Right: controls */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <button onClick={() => setShowNotifSetup(true)}
                style={{ width: 32, height: 32, borderRadius: 10, background: C.border, border: "none", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center", opacity: notifPerms ? 1 : 0.5 }}>🔔</button>
              <button onClick={() => setDarkMode(d => !d)}
                style={{ width: 32, height: 32, borderRadius: 10, background: C.border, border: "none", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center" }}>
                {darkMode ? "☀️" : "🌙"}
              </button>
              {!isPro && <button onClick={() => setShowUpgrade(true)} style={{ height: 32, padding: "0 10px", background: "linear-gradient(135deg,#FF9F0A,#FF5C00)", borderRadius: 10, fontSize: 11, fontWeight: 800, color: "#fff", border: "none", letterSpacing: 0.3 }}>⚡ PRO</button>}
              {/* Sync status dot */}
              {syncStatus !== "idle" && (
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: syncStatus === "saving" ? C.orange : syncStatus === "saved" ? "#34C759" : C.red, animation: syncStatus === "saving" ? "pulse 1s infinite" : "none" }} title={syncStatus} />
              )}
            </div>
            {habitStreak > 0 && (
              <div style={{ display: "flex", alignItems: "center", gap: 4, background: "#FF9F0A18", border: "1px solid #FF9F0A40", borderRadius: 20, padding: "3px 10px" }}>
                <span style={{ fontSize: 12 }}>🔥</span>
                <span style={{ fontSize: 11, fontWeight: 800, color: "#FF9F0A" }}>{habitStreak} day streak</span>
              </div>
            )}
          </div>
        </div>
      </div>

      <div style={{ paddingBottom: 88 }}>

        {/* ══ HOME ══ */}
        {tab === "home" && (
          <div style={{ animation: "fadeUp .3s ease", padding: "18px 18px" }}>
            {/* Summary grid */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
              {[
                { label: "Calories",  val: totalCal,  sub: `/ ${CALORIE_GOAL} kcal`, col: C.accent,  icon: "🔥" },
                { label: "Water",     val: water,      sub: `/ ${waterGoal} oz`, col: C.blue,   icon: "💧" },
                { label: "Habits",    val: habitsDone, sub: `/ ${habits.length} today`, col: C.orange, icon: "✅" },
                { label: "Weight",    val: weightLog.length ? weightLog[weightLog.length - 1].weight : "—", sub: "lbs · latest", col: C.purple, icon: "⚖️" },
              ].map(c => (
                <div key={c.label} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: "14px 12px" }}>
                  <div style={{ fontSize: 18, marginBottom: 5 }}>{c.icon}</div>
                  <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 22, fontWeight: 800, color: c.col }}>{c.val}</div>
                  <div style={{ fontSize: 10, color: C.muted, marginTop: 1 }}>{c.sub}</div>
                  <div style={{ fontSize: 10, color: C.muted, fontWeight: 600, marginTop: 1 }}>{c.label}</div>
                </div>
              ))}
            </div>

            {/* Water tracker */}
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: 16, marginBottom: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>💧 Water Intake</div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <div style={{ fontSize: 12, color: C.blue, fontWeight: 700 }}>{water}/</div>
                  {editingWaterGoal ? (
                    <input type="number" autoFocus
                      defaultValue={waterGoal}
                      onBlur={e => { const v = parseInt(e.target.value); if (v > 0) setWaterGoal(v); setEditingWaterGoal(false); }}
                      onKeyDown={e => { if (e.key === "Enter") e.target.blur(); }}
                      style={{ width: 52, padding: "2px 6px", background: C.bg, border: `1px solid ${C.blue}`, borderRadius: 6, color: C.blue, fontSize: 12, fontWeight: 700, textAlign: "center" }} />
                  ) : (
                    <button onClick={() => setEditingWaterGoal(true)}
                      style={{ fontSize: 12, color: C.blue, fontWeight: 700, background: "none", border: "none", cursor: "pointer", textDecoration: "underline dotted", padding: 0 }}>{waterGoal} oz ✎</button>
                  )}
                </div>
              </div>
              <div style={{ display: "flex", gap: 5, marginBottom: 10 }}>
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} onClick={() => setWater(Math.round((i + 1) * waterGoal / 8))}
                    style={{ flex: 1, height: 28, borderRadius: 7, cursor: "pointer", transition: "all .2s", background: water >= Math.round((i + 1) * waterGoal / 8) ? C.blue : C.border, opacity: water >= Math.round((i + 1) * waterGoal / 8) ? 1 : 0.35 }} />
                ))}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="bact" onClick={() => setWater(Math.max(0, water - 8))}
                  style={{ flex: 1, padding: "8px", background: C.border, borderRadius: 9, color: C.text, fontSize: 13, fontWeight: 600 }}>−</button>
                <button className="bact" onClick={() => setWater(Math.min(waterGoal, water + 8))}
                  style={{ flex: 2, padding: "8px", background: C.blue, borderRadius: 9, color: "#fff", fontSize: 13, fontWeight: 600 }}>+ 8 oz</button>
              </div>
            </div>

            {/* Habits */}
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>✅ Today's Habits</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {habitStreak > 0 && <div style={{ fontSize: 11, color: C.orange, fontWeight: 700 }}>🔥 {habitStreak}d</div>}
                  <button onClick={() => setShowHabitManager(true)}
                    style={{ fontSize: 10, fontWeight: 700, color: C.accent, background: C.accentDim, border: `1px solid ${C.accentBorder}`, borderRadius: 20, padding: "3px 10px" }}>
                    + Manage
                  </button>
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                {habits.map(h => {
                  const done = todayHabits[h.id];
                  return (
                    <div key={h.id} onClick={() => toggleHabit(h.id)} style={{
                      display: "flex", alignItems: "center", gap: 12, padding: "10px 12px",
                      background: done ? C.accentDim : "transparent",
                      border: `1px solid ${done ? C.accentBorder : C.border}`,
                      borderRadius: 12, cursor: "pointer", transition: "all .2s",
                    }}>
                      <div style={{ fontSize: 18 }}>{h.icon}</div>
                      <div style={{ flex: 1, fontSize: 13, fontWeight: done ? 600 : 400, color: done ? C.accent : C.text }}>{h.label}</div>
                      <div style={{ width: 20, height: 20, borderRadius: "50%", background: done ? C.accent : "transparent",
                        border: `2px solid ${done ? C.accent : C.muted}`, display: "flex", alignItems: "center",
                        justifyContent: "center", fontSize: 10, color: C.bg, fontWeight: 700 }}>{done ? "✓" : ""}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* ══ TRAIN ══ */}
        {tab === "train" && (
          <div style={{ animation: "fadeUp .3s ease" }}>
            <SubNav
              options={[{ id: "workout", label: "🏋️ Workout" }, { id: "plan", label: "📋 Plan" }, { id: "weight", label: "📈 Weight" }, { id: "measure", label: "📏 Measure" }]}
              active={trainSub} onChange={setTrainSub} C={C}
            />

            {/* — Workout — */}
            {trainSub === "workout" && (
              <div style={{ padding: "16px 18px", animation: "fadeUp .25s ease" }}>
                {!activeWorkout ? (
                  <>
                    <button className="bact" onClick={() => setActiveWorkout({ id: Date.now(), date: todayStr, exercises: [] })}
                      style={{ width: "100%", padding: 15, borderRadius: 13, fontSize: 15, fontWeight: 700, background: C.accent, color: C.bg, marginBottom: 22, animation: "glow 3s ease infinite" }}>
                      🏋️ Start Workout
                    </button>
                    {workouts.length === 0 ? (
                      <div style={{ textAlign: "center", padding: "50px 20px", background: C.card, borderRadius: 16, border: `1px dashed ${C.border}` }}>
                        <div style={{ fontSize: 42, marginBottom: 12 }}>🏋️</div>
                        <div style={{ fontWeight: 600, marginBottom: 6 }}>No workouts logged yet</div>
                        <div style={{ fontSize: 13, color: C.muted }}>Hit Start to begin tracking sets, reps & weight.</div>
                      </div>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                        <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", marginBottom: 4 }}>Past Workouts</div>
                        {workouts.map(w => (
                          <div key={w.id} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 15, padding: 15 }}>
                            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                              <div style={{ fontWeight: 700 }}>Workout · {w.date}</div>
                              <div style={{ fontSize: 12, color: C.muted }}>{w.exercises.length} exercises</div>
                            </div>
                            {w.exercises.map((ex, ei) => (
                              <div key={ei} style={{ fontSize: 12, color: C.muted, marginBottom: 3 }}>
                                <span style={{ color: C.text, fontWeight: 500 }}>{ex.name}</span>
                                {" · "}{ex.sets.filter(s => s.reps).map(s => `${s.reps}×${s.weight}lb`).join(", ") || "logged"}
                              </div>
                            ))}
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                      <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 20, fontWeight: 800 }}>Active Workout 🔥</div>
                      <button className="bact" onClick={() => { setWorkouts(p => [activeWorkout, ...p]); setActiveWorkout(null); }}
                        style={{ padding: "9px 16px", background: C.accent, color: C.bg, borderRadius: 10, fontSize: 13, fontWeight: 700 }}>Finish</button>
                    </div>

                    {activeWorkout.exercises.map((ex, ei) => (
                      <div key={ei} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 14, marginBottom: 10 }}>
                        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10, color: C.accent }}>{ex.name}</div>
                        <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                          {["Set","Weight (lb)","Reps"].map((h, i) => (
                            <div key={h} style={{ flex: i === 0 ? 1 : 2, fontSize: 9, color: C.muted, fontWeight: 700, textTransform: "uppercase", textAlign: "center" }}>{h}</div>
                          ))}
                        </div>
                        {ex.sets.map((s, si) => (
                          <div key={si} style={{ display: "flex", gap: 6, marginBottom: 5, alignItems: "center" }}>
                            <div style={{ flex: 1, textAlign: "center", fontSize: 12, color: C.muted, fontWeight: 600 }}>{si + 1}</div>
                            <input value={s.weight} onChange={e => updateSet(ei, si, "weight", e.target.value)} placeholder="0" type="number"
                              style={{ flex: 2, padding: "8px 6px", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, fontSize: 13, textAlign: "center" }} />
                            <input value={s.reps} onChange={e => updateSet(ei, si, "reps", e.target.value)} placeholder="0" type="number"
                              style={{ flex: 2, padding: "8px 6px", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, fontSize: 13, textAlign: "center" }} />
                          </div>
                        ))}
                        <button className="bact" onClick={() => setActiveWorkout(w => ({ ...w, exercises: w.exercises.map((e, i) => i !== ei ? e : { ...e, sets: [...e.sets, { reps: "", weight: "" }] }) }))}
                          style={{ width: "100%", padding: "7px", background: C.accentDim, border: `1px solid ${C.accentBorder}`, borderRadius: 8, color: C.accent, fontSize: 11, fontWeight: 700, marginTop: 3 }}>
                          + Add Set
                        </button>
                      </div>
                    ))}

                    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 14 }}>
                      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 9 }}>Add Exercise</div>
                      <input value={exSearch} onChange={e => setExSearch(e.target.value)} placeholder="Search exercises..."
                        style={{ width: "100%", padding: "10px 12px", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 9, color: C.text, fontSize: 13, marginBottom: 8 }} />
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                        {EXERCISES.filter(e => e.toLowerCase().includes(exSearch.toLowerCase())).slice(0, 10).map(e => (
                          <button key={e} className="bact" onClick={() => { setActiveWorkout(w => ({ ...w, exercises: [...w.exercises, { name: e, sets: [{ reps: "", weight: "" }] }] })); setExSearch(""); }}
                            style={{ padding: "6px 11px", background: C.accentDim, border: `1px solid ${C.accentBorder}`, borderRadius: 18, color: C.accent, fontSize: 11, fontWeight: 600 }}>
                            {e}
                          </button>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* — Weight — */}
            {/* ── WORKOUT PLAN TAB ── */}
            {trainSub === "plan" && (
              <div style={{ padding: "16px 18px", animation: "fadeUp .25s ease" }}>
                {!isPro ? (
                  <div style={{ textAlign: "center", padding: "32px 0" }}>
                    <div style={{ fontSize: 48, marginBottom: 12 }}>📋</div>
                    <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 18, fontWeight: 800, marginBottom: 8 }}>AI Workout Plans</div>
                    <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.7, marginBottom: 20 }}>Personalized weekly training split based on your schedule and goals. Pro feature.</div>
                    <button className="bact" onClick={() => setShowUpgrade(true)}
                      style={{ padding: "13px 28px", background: "linear-gradient(135deg,#FF9F0A,#FF5C00)", color: "#000", borderRadius: 13, fontSize: 14, fontWeight: 800 }}>⚡ Upgrade to Pro</button>
                  </div>
                ) : workoutPlan ? (
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                      <div>
                        <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 17, fontWeight: 800 }}>{workoutPlan.name}</div>
                        <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{workoutPlan.frequency} · {workoutPlan.level}</div>
                      </div>
                      <button className="bact" onClick={() => setWorkoutPlan(null)}
                        style={{ padding: "6px 12px", background: C.border, borderRadius: 9, fontSize: 11, color: C.muted, fontWeight: 600 }}>Redo</button>
                    </div>
                    <div style={{ fontSize: 11, color: C.muted, marginBottom: 16 }}>{workoutPlan.goal} · {workoutPlan.equipment}</div>
                    {workoutPlan.days.map((day, i) => (
                      <div key={i} style={{ background: C.card, border: `1px solid ${day.rest ? C.border : C.accentBorder}`, borderRadius: 14, padding: 14, marginBottom: 10 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: day.rest ? 0 : 10 }}>
                          <div style={{ fontWeight: 700, fontSize: 13, color: day.rest ? C.muted : C.accent }}>{day.day}</div>
                          <div style={{ fontSize: 11, fontWeight: 600, background: day.rest ? C.border : C.accentDim, color: day.rest ? C.bg : C.accent, padding: "2px 10px", borderRadius: 20 }}>{day.focus}</div>
                        </div>
                        {!day.rest && day.exercises?.map((ex, j) => (
                          <div key={j} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 0", borderTop: `1px solid ${C.border}` }}>
                            <div style={{ fontSize: 12, fontWeight: 600 }}>{ex.name}</div>
                            <div style={{ display: "flex", gap: 8 }}>
                              <span style={{ fontSize: 11, color: C.accent, fontWeight: 700 }}>{ex.sets}</span>
                              {ex.rest && <span style={{ fontSize: 10, color: C.muted }}>{ex.rest} rest</span>}
                            </div>
                          </div>
                        ))}
                        {!day.rest && day.notes && <div style={{ fontSize: 10, color: C.muted, marginTop: 8, fontStyle: "italic" }}>{day.notes}</div>}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div>
                    <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 16, fontWeight: 800, marginBottom: 4 }}>📋 Build Your Plan</div>
                    <div style={{ fontSize: 12, color: C.muted, marginBottom: 18 }}>Customize your schedule and we'll build the perfect weekly split.</div>

                    <div style={{ marginBottom: 16 }}>
                      <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, marginBottom: 8, letterSpacing: 0.5 }}>DAYS PER WEEK</div>
                      <div style={{ display: "flex", gap: 6 }}>
                        {["2","3","4","5","6"].map(d => (
                          <button key={d} onClick={() => setWorkoutPrefs(p => ({...p, days: d}))}
                            style={{ flex: 1, padding: "10px 0", borderRadius: 10, fontSize: 15, fontWeight: 800,
                              background: workoutPrefs.days === d ? C.accent : C.card,
                              color: workoutPrefs.days === d ? C.bg : C.muted,
                              border: `1.5px solid ${workoutPrefs.days === d ? C.accent : C.border}`, transition: "all .15s" }}>{d}</button>
                        ))}
                      </div>
                    </div>

                    <div style={{ marginBottom: 16 }}>
                      <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, marginBottom: 8, letterSpacing: 0.5 }}>SESSION LENGTH</div>
                      <div style={{ display: "flex", gap: 6 }}>
                        {[{id:"30min",label:"30 min"},{id:"45min",label:"45 min"},{id:"60min",label:"1 hour"},{id:"90min",label:"90 min"}].map(opt => (
                          <button key={opt.id} onClick={() => setWorkoutPrefs(p => ({...p, intensity: opt.id}))}
                            style={{ flex: 1, padding: "8px 0", borderRadius: 10, fontSize: 11, fontWeight: 700,
                              background: workoutPrefs.intensity === opt.id ? C.accent : C.card,
                              color: workoutPrefs.intensity === opt.id ? C.bg : C.muted,
                              border: `1.5px solid ${workoutPrefs.intensity === opt.id ? C.accent : C.border}`, transition: "all .15s" }}>{opt.label}</button>
                        ))}
                      </div>
                    </div>

                    <div style={{ marginBottom: 16 }}>
                      <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, marginBottom: 8, letterSpacing: 0.5 }}>EQUIPMENT</div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {[{id:"full_gym",label:"🏋️ Full Gym"},{id:"home",label:"🏠 Home Only"},{id:"dumbbells",label:"🪣 Dumbbells"},{id:"bodyweight",label:"🤸 Bodyweight"}].map(opt => (
                          <button key={opt.id} onClick={() => setWorkoutPrefs(p => ({...p, equipment: opt.id}))}
                            style={{ padding: "8px 12px", borderRadius: 20, fontSize: 12, fontWeight: 600,
                              background: workoutPrefs.equipment === opt.id ? C.accentDim : C.card,
                              color: workoutPrefs.equipment === opt.id ? C.accent : C.muted,
                              border: `1.5px solid ${workoutPrefs.equipment === opt.id ? C.accent : C.border}`, transition: "all .15s" }}>{opt.label}</button>
                        ))}
                      </div>
                    </div>

                    <div style={{ marginBottom: 22 }}>
                      <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, marginBottom: 8, letterSpacing: 0.5 }}>MAIN GOAL</div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {[{id:"lose_fat",label:"🔥 Lose Fat"},{id:"build_muscle",label:"💪 Build Muscle"},{id:"get_stronger",label:"🏋️ Get Stronger"},{id:"endurance",label:"🏃 Endurance"},{id:"stay_active",label:"✅ Stay Active"}].map(opt => (
                          <button key={opt.id} onClick={() => setWorkoutPrefs(p => ({...p, goal: opt.id}))}
                            style={{ padding: "8px 12px", borderRadius: 20, fontSize: 12, fontWeight: 600,
                              background: workoutPrefs.goal === opt.id ? C.accentDim : C.card,
                              color: workoutPrefs.goal === opt.id ? C.accent : C.muted,
                              border: `1.5px solid ${workoutPrefs.goal === opt.id ? C.accent : C.border}`, transition: "all .15s" }}>{opt.label}</button>
                        ))}
                      </div>
                    </div>

                    {workoutPlanLoading ? (
                      <div style={{ display: "flex", justifyContent: "center", gap: 8, padding: "20px 0" }}>
                        {[0,1,2].map(d => <div key={d} style={{ width: 10, height: 10, borderRadius: "50%", background: C.accent, animation: `pulse 1.2s ease ${d*.2}s infinite` }} />)}
                      </div>
                    ) : (
                      <button className="bact" onClick={async () => {
                        setWorkoutPlanLoading(true);
                        try {
                          const goalLabel = workoutPrefs.goal || GOALS.find(g=>g.id===profile.goal)?.label || "general fitness";
                          const equipLabel = {full_gym:"full gym equipment",home:"home with no equipment",dumbbells:"dumbbells only",bodyweight:"bodyweight only"}[workoutPrefs.equipment] || workoutPrefs.equipment;
                          const resp = await fetch("https://api.anthropic.com/v1/messages", {
                            method: "POST", headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 2000,
                              messages: [{ role: "user", content: `Create a ${workoutPrefs.days}-day/week workout plan. Goal: ${goalLabel}. Session length: ${workoutPrefs.intensity || "60min"}. Equipment: ${equipLabel}. Experience: ${profile.experience || "beginner"}. Return ONLY valid JSON no markdown: {"name":"5-Day Strength Split","frequency":"${workoutPrefs.days} days/week","level":"Intermediate","goal":"${goalLabel}","equipment":"${equipLabel}","days":[{"day":"Monday","focus":"Chest & Triceps","exercises":[{"name":"Bench Press","sets":"4x8","rest":"90s"},{"name":"Incline Dumbbell Press","sets":"3x10","rest":"60s"},{"name":"Tricep Pushdown","sets":"3x12","rest":"60s"}],"notes":"Focus on mind-muscle connection"},{"day":"Tuesday","focus":"Rest","rest":true},{"day":"Wednesday","focus":"Back & Biceps","exercises":[{"name":"Deadlift","sets":"4x5","rest":"2min"},{"name":"Pull-Ups","sets":"3x8","rest":"90s"},{"name":"Bicep Curls","sets":"3x12","rest":"60s"}]},{"day":"Thursday","focus":"Rest","rest":true},{"day":"Friday","focus":"Legs","exercises":[{"name":"Squat","sets":"4x8","rest":"2min"},{"name":"Leg Press","sets":"3x12","rest":"90s"},{"name":"Calf Raises","sets":"4x15","rest":"45s"}]},{"day":"Saturday","focus":"Shoulders & Core","exercises":[{"name":"Overhead Press","sets":"4x8","rest":"90s"},{"name":"Lateral Raises","sets":"3x15","rest":"45s"},{"name":"Plank","sets":"3x60s","rest":"30s"}]},{"day":"Sunday","focus":"Rest","rest":true}]}` }]
                            })
                          });
                          const data = await resp.json();
                          const txt = data.content?.map(c=>c.text||"").join("") || "{}";
                          const plan = JSON.parse(txt.replace(/```json|```/g,"").trim());
                          setWorkoutPlan(plan);
                        } catch(e) { alert("Could not generate plan. Try again."); }
                        setWorkoutPlanLoading(false);
                      }} style={{ width: "100%", padding: "14px", background: C.accent, color: C.bg, borderRadius: 13, fontSize: 14, fontWeight: 800 }}>
                        ✨ Generate My Workout Plan
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* ── MEASUREMENTS TAB ── */}
            {trainSub === "measure" && (
              <div style={{ padding: "16px 18px", animation: "fadeUp .25s ease" }}>
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 16, fontWeight: 800, marginBottom: 4 }}>📏 Body Measurements</div>
                  <div style={{ fontSize: 12, color: C.muted }}>Track what the scale can't show — inches lost matter.</div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "calc(50% - 5px) calc(50% - 5px)", gap: 10, marginBottom: 16, width: "100%" }}>
                  {[
                    { key: "waist", label: "Waist", icon: "📏" },
                    { key: "chest", label: "Chest", icon: "🫁" },
                    { key: "hips", label: "Hips", icon: "🩳" },
                    { key: "arms", label: "Arms", icon: "💪" },
                    { key: "thighs", label: "Thighs", icon: "🦵" },
                    { key: "neck", label: "Neck", icon: "🧣" },
                  ].map(m => (
                    <div key={m.key} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 11, padding: "8px 10px", minWidth: 0, overflow: "hidden" }}>
                      <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, marginBottom: 5, letterSpacing: 0.5 }}>{m.icon} {m.label.toUpperCase()}</div>
                      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <input type="text" inputMode="decimal" value={measurements[m.key]} onChange={e => setMeasurements(p => ({...p, [m.key]: e.target.value}))}
                          placeholder="—"
                          style={{ flex: 1, padding: "5px 4px", background: C.bg, border: `1px solid ${measurements[m.key] ? C.accentBorder : C.border}`, borderRadius: 7, color: C.accent, fontSize: 15, fontWeight: 700, textAlign: "center", width: "100%", minWidth: 0 }} />
                        <span style={{ fontSize: 10, color: C.muted, fontWeight: 600, flexShrink: 0 }}>in</span>
                      </div>
                      {measureLog.length > 0 && measureLog[measureLog.length-1][m.key] && measurements[m.key] && (
                        <div style={{ fontSize: 9, color: C.muted, marginTop: 3, textAlign: "center" }}>
                          {(() => { const prev = parseFloat(measureLog[measureLog.length-1][m.key]); const cur = parseFloat(measurements[m.key]); const diff = cur - prev; return diff !== 0 ? <span style={{ color: diff < 0 ? C.accent : C.red }}>{diff > 0 ? "+" : ""}{diff.toFixed(1)}"</span> : null; })()}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                <button className="bact" onClick={() => {
                  if (Object.values(measurements).some(v => v)) {
                    setMeasureLog(p => [...p, { ...measurements, date: todayStr }]);
                    alert("Measurements saved! ✓");
                  }
                }} style={{ width: "100%", padding: "13px", background: C.accent, color: C.bg, borderRadius: 12, fontSize: 14, fontWeight: 700, marginBottom: 16 }}>
                  Save Today's Measurements
                </button>
                {measureLog.length > 0 && (
                  <div>
                    <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: 1, marginBottom: 10 }}>HISTORY</div>
                    {[...measureLog].reverse().map((entry, i) => (
                      <div key={i} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 12, marginBottom: 8 }}>
                        <div style={{ fontSize: 11, color: C.accent, fontWeight: 700, marginBottom: 8 }}>{entry.date}</div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                          {Object.entries(entry).filter(([k]) => k !== "date").map(([k,v]) => v ? (
                            <div key={k} style={{ fontSize: 11, color: C.muted }}><span style={{ color: C.text, fontWeight: 600 }}>{k}</span> {v}"</div>
                          ) : null)}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

                        {trainSub === "weight" && (
              <div style={{ padding: "16px 18px", animation: "fadeUp .25s ease" }}>
                <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 15, marginBottom: 14 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 10 }}>Log Today's Weight</div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <input value={weightInput} onChange={e => setWeightInput(e.target.value)} placeholder="e.g. 185.5" type="number"
                      style={{ flex: 1, padding: "12px 13px", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 11, color: C.text, fontSize: 16, fontWeight: 600 }} />
                    <button className="bact" onClick={() => {
                      if (!weightInput) return;
                      setWeightLog(p => [...p.filter(w => w.date !== "Today"), { date: "Today", weight: parseFloat(weightInput) }]);
                      setWeightInput("");
                    }} style={{ padding: "0 18px", background: C.accent, color: C.bg, borderRadius: 11, fontSize: 14, fontWeight: 700 }}>Save</button>
                  </div>
                </div>

                {weightLog.length >= 1 && (() => {
                  const first = weightLog[0].weight, last = weightLog[weightLog.length - 1].weight;
                  const diff = (last - first).toFixed(1);
                  return (
                    <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
                      <div style={{ flex: 1, background: C.card, border: `1px solid ${C.border}`, borderRadius: 13, padding: "13px 8px", textAlign: "center" }}>
                        <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 17, fontWeight: 800, color: C.accent }}>{last}<span style={{ fontSize: 10, color: C.muted, fontFamily: "'Plus Jakarta Sans'" }}> lbs</span></div>
                        <div style={{ fontSize: 9, color: C.muted, marginTop: 2 }}>Current</div>
                      </div>
                      <div style={{ flex: 1, background: C.card, border: `1px solid ${C.border}`, borderRadius: 13, padding: "13px 8px", textAlign: "center" }}>
                        {editingStart ? (
                          <input autoFocus type="number" value={startInput}
                            onChange={e => setStartInput(e.target.value)}
                            onBlur={() => {
                              const v = parseFloat(startInput);
                              if (v > 0) setWeightLog(p => [{ ...p[0], weight: v }, ...p.slice(1)]);
                              setEditingStart(false);
                            }}
                            onKeyDown={e => e.key === "Enter" && e.target.blur()}
                            style={{ width: "100%", background: "none", border: "none", borderBottom: `1px solid ${C.accent}`, color: C.text, fontSize: 17, fontWeight: 800, textAlign: "center", fontFamily: "'Bebas Neue',sans-serif" }} />
                        ) : (
                          <div onClick={() => { setStartInput(String(first)); setEditingStart(true); }} style={{ cursor: "pointer" }}>
                            <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 17, fontWeight: 800, color: C.muted }}>{first}<span style={{ fontSize: 10, color: C.muted, fontFamily: "'Plus Jakarta Sans'" }}> lbs</span></div>
                            <div style={{ fontSize: 9, color: C.muted, marginTop: 2 }}>Starting ✎</div>
                          </div>
                        )}
                      </div>
                      {weightLog.length >= 2 && (
                        <div style={{ flex: 1, background: C.card, border: `1px solid ${C.border}`, borderRadius: 13, padding: "13px 8px", textAlign: "center" }}>
                          <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 17, fontWeight: 800, color: diff < 0 ? C.accent : C.red }}>{diff > 0 ? "+" : ""}{diff}<span style={{ fontSize: 10, color: C.muted, fontFamily: "'Plus Jakarta Sans'" }}> lbs</span></div>
                          <div style={{ fontSize: 9, color: C.muted, marginTop: 2 }}>Change</div>
                        </div>
                      )}
                    </div>
                  );
                })()}

                <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: "14px 4px 8px", marginBottom: 14 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, paddingLeft: 12, marginBottom: 12 }}>Weight Over Time</div>
                  <ResponsiveContainer width="100%" height={185}>
                    <LineChart data={weightLog} margin={{ left: -14, right: 10, top: 4, bottom: 4 }}>
                      <CartesianGrid stroke={C.border} strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="date" tick={{ fill: C.muted, fontSize: 9 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: C.muted, fontSize: 9 }} axisLine={false} tickLine={false} domain={["auto", "auto"]} />
                      <Tooltip contentStyle={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 9, color: C.text, fontSize: 12 }}
                        itemStyle={{ color: C.accent }} labelStyle={{ color: C.muted, marginBottom: 3 }} />
                      <Line type="monotone" dataKey="weight" stroke={C.accent} strokeWidth={2.5}
                        dot={{ fill: C.accent, r: 4, strokeWidth: 0 }} activeDot={{ r: 6, fill: C.accent }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>

                <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", marginBottom: 8 }}>History</div>
                <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 13, overflow: "hidden" }}>
                  {[...weightLog].reverse().map((w, i, arr) => (
                    <div key={i} style={{ padding: "11px 13px", borderBottom: i < arr.length - 1 ? `1px solid ${C.border}` : "none", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div style={{ fontSize: 12, color: C.muted }}>{w.date}</div>
                      <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 15, fontWeight: 700 }}>{w.weight} <span style={{ fontSize: 10, color: C.muted, fontFamily: "'Plus Jakarta Sans'" }}>lbs</span></div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ══ TRACK ══ */}
        {tab === "track" && (
          <div style={{ animation: "fadeUp .3s ease" }}>
            <SubNav
              options={[{ id: "calories", label: "🔥 Calories" }, { id: "photos", label: "📸 Photos" }, { id: "meals", label: "🥗 Meals" }, { id: "awards", label: "🏅 Awards" }, { id: "connect", label: "🔗 Connect" }]}
              active={trackSub} onChange={setTrackSub} C={C}
            />

            {/* — Calories — */}
            {trackSub === "calories" && (
              <div style={{ padding: "16px 18px", animation: "fadeUp .25s ease" }}>

                {/* Ring + macros */}
                <div style={{ display: "flex", justifyContent: "center", paddingBottom: 16 }}>
                  <div style={{ position: "relative", width: 148, height: 148 }}>
                    <svg width="148" height="148" style={{ transform: "rotate(-90deg)" }}>
                      <circle cx="74" cy="74" r="52" fill="none" stroke={C.border} strokeWidth="9" />
                      <circle cx="74" cy="74" r="52" fill="none" stroke={calPct >= 100 ? C.red : C.accent} strokeWidth="9" strokeLinecap="round"
                        strokeDasharray={circ} strokeDashoffset={circ - (calPct / 100) * circ} style={{ transition: "stroke-dashoffset .6s ease" }} />
                    </svg>
                    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
                      <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 26, fontWeight: 800, color: calPct >= 100 ? C.red : C.accent }}>{totalCal}</div>
                      <div style={{ fontSize: 9, color: C.muted }}>of {CALORIE_GOAL} kcal</div>
                    </div>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                  {[{ l: "Protein", v: Math.round(totalProtein), col: C.blue }, { l: "Carbs", v: Math.round(totalCarbs), col: C.orange }, { l: "Fat", v: Math.round(totalFat), col: C.purple }].map(m => (
                    <div key={m.l} style={{ flex: 1, background: C.card, border: `1px solid ${C.border}`, borderRadius: 13, padding: "12px 6px", textAlign: "center" }}>
                      <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 18, fontWeight: 800, color: m.col }}>{m.v}g</div>
                      <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>{m.l}</div>
                    </div>
                  ))}
                </div>

                {/* Add food toggle */}
                <button className="bact" onClick={() => setShowFoodSearch(p => !p)} style={{
                  width: "100%", padding: 13, borderRadius: 13, fontSize: 14, fontWeight: 700, marginBottom: 13,
                  background: showFoodSearch ? C.accentDim : C.accent, color: showFoodSearch ? C.accent : C.bg,
                  border: `1.5px solid ${C.accent}`, transition: "all .2s"
                }}>{showFoodSearch ? "✕ Close" : "+ Add Food"}</button>

                {/* Food panel */}
                {showFoodSearch && (
                  <div style={{ animation: "fadeUp .2s ease", marginBottom: 13 }}>

                    {/* Sub tabs — row 1 */}
                    <div style={{ display: "flex", background: C.card, border: `1px solid ${C.border}`, borderRadius: 11, padding: 4, gap: 3, marginBottom: 6 }}>
                      {[{ id: "search", label: "🔍 Search" }, { id: "favorites", label: `⭐ Favs${favorites.length ? ` (${favorites.length})` : ""}` }, { id: "create", label: "✏️ Create" }].map(ft => (
                        <button key={ft.id} onClick={() => setFoodTab(ft.id)} style={{
                          flex: 1, padding: "7px 4px", borderRadius: 8, fontSize: 11, fontWeight: 700,
                          background: foodTab === ft.id ? C.accent : "transparent",
                          color: foodTab === ft.id ? C.bg : C.muted,
                          border: "none", transition: "all .2s", whiteSpace: "nowrap",
                        }}>{ft.label}</button>
                      ))}
                    </div>
                    {/* Sub tabs — row 2 */}
                    <div style={{ display: "flex", background: C.card, border: `1px solid ${C.border}`, borderRadius: 11, padding: 4, gap: 3, marginBottom: 12 }}>
                      <button onClick={() => setFoodTab("scan")} style={{
                        flex: 1, padding: "7px 4px", borderRadius: 8, fontSize: 11, fontWeight: 700,
                        background: foodTab === "scan" ? C.blue : "transparent",
                        color: foodTab === "scan" ? "#fff" : C.muted,
                        border: "none", transition: "all .2s",
                      }}>📸 Scan Meal</button>
                      {/* 〔|〕Barcode tab hidden — needs real network (not available in sandbox) */}
                    </div>

                    {/* SEARCH tab */}
                    {foodTab === "search" && (() => {
                      const allFoods = [...FOODS, ...customFoods];
                      const results = allFoods.filter(f => f.name.toLowerCase().includes(foodSearch.toLowerCase()));
                      return (
                        <div>
                          <input value={foodSearch} onChange={e => setFoodSearch(e.target.value)} placeholder="Search foods..."
                            style={{ width: "100%", padding: "11px 13px", background: C.card, border: `1px solid ${C.border}`, borderRadius: 11, color: C.text, fontSize: 13, marginBottom: 7 }} />
                          {results.length === 0
                            ? <div style={{ textAlign: "center", padding: "20px", color: C.muted, fontSize: 13 }}>No foods found. Try creating one!</div>
                            : <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 13, overflow: "hidden" }}>
                                {results.map((f, i) => {
                                  const isFav = favorites.some(fv => fv.name === f.name);
                                  return (
                                    <div key={i} style={{ padding: "11px 13px", borderBottom: i < results.length - 1 ? `1px solid ${C.border}` : "none",
                                      display: "flex", alignItems: "center", gap: 8, transition: "background .15s" }}>
                                      <div className="rhov" onClick={() => setServingPicker({ food: f, qty: "1", unit: "serving" })}
                                        style={{ flex: 1, cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                        <div>
                                          <div style={{ fontSize: 13, fontWeight: 500 }}>{f.name}{f.custom && <span style={{ fontSize: 9, color: C.accent, fontWeight: 700, marginLeft: 6, background: C.accentDim, padding: "1px 5px", borderRadius: 4 }}>CUSTOM</span>}</div>
                                          <div style={{ fontSize: 10, color: C.muted, marginTop: 1 }}>P:{f.protein}g C:{f.carbs}g F:{f.fat}g</div>
                                        </div>
                                        <div style={{ fontSize: 14, fontWeight: 800, color: C.accent, marginRight: 4 }}>{f.cal}</div>
                                      </div>
                                      <button onClick={() => setFavorites(fvs => isFav ? fvs.filter(fv => fv.name !== f.name) : [...fvs, f])}
                                        style={{ background: "none", fontSize: 18, lineHeight: 1, color: isFav ? C.yellow : C.muted, padding: "0 2px", flexShrink: 0 }}>
                                        {isFav ? "★" : "☆"}
                                      </button>
                                    </div>
                                  );
                                })}
                              </div>
                          }
                        </div>
                      );
                    })()}

                    {/* FAVORITES tab */}
                    {foodTab === "favorites" && (() => {
                      const filteredFavs = favorites.filter(f => f.name.toLowerCase().includes(favSearch.toLowerCase()));
                      return (
                        <div>
                          {favorites.length === 0 ? (
                            <div style={{ textAlign: "center", padding: "28px 16px", background: C.card, border: `1px solid ${C.border}`, borderRadius: 13 }}>
                              <div style={{ fontSize: 32, marginBottom: 8 }}>⭐</div>
                              <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.6 }}>No favorites yet. Tap the ☆ next to any food to save it here.</div>
                            </div>
                          ) : (
                            <div>
                              <input value={favSearch} onChange={e => setFavSearch(e.target.value)} placeholder="Search favorites..."
                                style={{ width: "100%", padding: "11px 13px", background: C.card, border: `1px solid ${C.border}`, borderRadius: 11, color: C.text, fontSize: 13, marginBottom: 7 }} />
                              {filteredFavs.length === 0
                                ? <div style={{ textAlign: "center", padding: "16px", color: C.muted, fontSize: 13 }}>No favorites match "{favSearch}"</div>
                                : <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 13, overflow: "hidden" }}>
                                    {filteredFavs.map((f, i) => (
                                      <div key={i} style={{ padding: "11px 13px", borderBottom: i < filteredFavs.length - 1 ? `1px solid ${C.border}` : "none",
                                        display: "flex", alignItems: "center", gap: 8 }}>
                                        <div className="rhov" onClick={() => setServingPicker({ food: f, qty: "1", unit: "serving" })}
                                          style={{ flex: 1, cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                          <div>
                                            <div style={{ fontSize: 13, fontWeight: 500 }}>{f.name}{f.custom && <span style={{ fontSize: 9, color: C.accent, fontWeight: 700, marginLeft: 6, background: C.accentDim, padding: "1px 5px", borderRadius: 4 }}>CUSTOM</span>}</div>
                                            <div style={{ fontSize: 10, color: C.muted, marginTop: 1 }}>P:{f.protein}g C:{f.carbs}g F:{f.fat}g</div>
                                          </div>
                                          <div style={{ fontSize: 14, fontWeight: 800, color: C.accent, marginRight: 4 }}>{f.cal}</div>
                                        </div>
                                        <button onClick={() => setFavorites(fvs => fvs.filter(fv => fv.name !== f.name))}
                                          style={{ background: "none", fontSize: 18, color: C.yellow, padding: "0 2px", flexShrink: 0 }}>★</button>
                                      </div>
                                    ))}
                                  </div>
                              }
                            </div>
                          )}
                        </div>
                      );
                    })()}

                    {/* CREATE tab */}
                    {foodTab === "create" && (
                      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 13, padding: 14 }}>
                        <div style={{ fontSize: 12, color: C.accent, fontWeight: 700, marginBottom: 12 }}>Create Custom Food</div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                          <div>
                            <div style={{ fontSize: 10, color: C.muted, fontWeight: 600, marginBottom: 5, letterSpacing: 0.5 }}>FOOD NAME</div>
                            <input value={newFood.name} onChange={e => setNewFood(p => ({ ...p, name: e.target.value }))}
                              placeholder="e.g. My Protein Shake"
                              style={{ width: "100%", padding: "10px 12px", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 9, color: C.text, fontSize: 13 }} />
                          </div>
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                            {[
                              { key: "cal", label: "CALORIES", placeholder: "e.g. 250", col: C.accent },
                              { key: "protein", label: "PROTEIN (g)", placeholder: "e.g. 25", col: C.blue },
                              { key: "carbs", label: "CARBS (g)", placeholder: "e.g. 30", col: C.orange },
                              { key: "fat", label: "FAT (g)", placeholder: "e.g. 8", col: C.purple },
                            ].map(field => (
                              <div key={field.key}>
                                <div style={{ fontSize: 10, color: field.col, fontWeight: 700, marginBottom: 5, letterSpacing: 0.5 }}>{field.label}</div>
                                <input type="number" value={newFood[field.key]} onChange={e => setNewFood(p => ({ ...p, [field.key]: e.target.value }))}
                                  placeholder={field.placeholder}
                                  style={{ width: "100%", padding: "10px 10px", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 9, color: C.text, fontSize: 13 }} />
                              </div>
                            ))}
                          </div>
                          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                            <button className="bact" onClick={() => setNewFood({ name: "", cal: "", protein: "", carbs: "", fat: "" })}
                              style={{ flex: 1, padding: "10px", background: C.border, borderRadius: 9, color: C.muted, fontSize: 12, fontWeight: 600 }}>Clear</button>
                            <button className="bact"
                              disabled={!newFood.name || !newFood.cal}
                              onClick={() => {
                                const food = { name: newFood.name, cal: parseFloat(newFood.cal) || 0, protein: parseFloat(newFood.protein) || 0, carbs: parseFloat(newFood.carbs) || 0, fat: parseFloat(newFood.fat) || 0, custom: true };
                                setCustomFoods(p => [...p, food]);
                                setNewFood({ name: "", cal: "", protein: "", carbs: "", fat: "" });
                                setServingPicker({ food, qty: "1", unit: "serving" });
                              }}
                              style={{ flex: 2, padding: "10px", background: newFood.name && newFood.cal ? C.accent : C.border, color: newFood.name && newFood.cal ? C.bg : C.muted, borderRadius: 9, fontSize: 13, fontWeight: 700, transition: "all .2s" }}>
                              Save & Add to Log
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* SCAN MEAL tab */}
                    {foodTab === "scan" && (
                      <div style={{ animation: "fadeUp .2s ease" }}>
                        {/* Hidden file inputs */}
                        {/* Hidden input for per-item label scanning */}
{/* item label scan input — re-enable with barcode feature */}

                        <input ref={scanFileRef} type="file" accept="image/*" capture="environment"
                          onChange={async e => {
                            const file = e.target.files[0]; if (!file) return;
                            const reader = new FileReader();
                            reader.onload = async ev => {
                              const base64 = ev.target.result;
                              setScanImage(base64);
                              setScanLoading(true);
                              setScanResults([]);
                              try {
                                const b64data = base64.split(",")[1];
                                const resp = await fetch("https://api.anthropic.com/v1/messages", {
                                  method: "POST",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({
                                    model: "claude-sonnet-4-20250514",
                                    max_tokens: 600,
                                    messages: [{
                                      role: "user",
                                      content: [
                                        { type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64data } },
                                        { type: "text", text: `Look at this meal photo and list only the distinct food items you can identify on the plate. Respond ONLY with a valid JSON array of item names, nothing else. No macros, no serving sizes, no explanation. Example: ["Grilled Chicken Breast","White Rice","Steamed Broccoli"]` }
                                      ]
                                    }]
                                  })
                                });
                                const data = await resp.json();
                                const text = data.content?.map(c => c.text || "").join("") || "[]";
                                const clean = text.replace(/```json|```/g, "").trim();
                                const names = JSON.parse(clean);
                                setScanResults(names.map(name => ({ name, confirmed: true, grams: "", cal: "", protein: "", carbs: "", fat: "", estimating: false })));
                              } catch(err) {
                                setScanResults([{ name: "Could not identify items — try again", error: true, confirmed: false, macroMode: null }]);
                              }
                              setScanLoading(false);
                            };
                            reader.readAsDataURL(file);
                          }} style={{ display: "none" }} />

                        {/* Prompt */}
                        {!scanImage && (
                          <div style={{ background: C.card, border: `1px dashed ${C.border}`, borderRadius: 14, padding: "32px 20px", textAlign: "center" }}>
                            <div style={{ fontSize: 44, marginBottom: 12 }}>🍽️</div>
                            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>Snap Your Meal</div>
                            <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.6, marginBottom: 20 }}>
                              AI identifies each item on your plate. Then you enter the weight and it estimates your macros.
                            </div>
                            {isPro
                              ? <button className="bact" onClick={() => scanFileRef.current.click()}
                                  style={{ width: "100%", padding: "13px", background: C.blue, color: "#fff", borderRadius: 12, fontSize: 14, fontWeight: 700 }}>
                                  📷 Take Photo of Meal
                                </button>
                              : <button className="bact" onClick={() => setShowUpgrade(true)}
                                  style={{ width: "100%", padding: "13px", background: "linear-gradient(135deg, #f59e0b, #f97316)", color: "#fff", borderRadius: 12, fontSize: 14, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                                  ⚡ Pro Feature — Upgrade
                                </button>
                            }
                          </div>
                        )}

                        {/* Loading */}
                        {scanImage && scanLoading && (
                          <div>
                            <img src={scanImage} style={{ width: "100%", borderRadius: 12, marginBottom: 12, maxHeight: 180, objectFit: "cover" }} />
                            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 13, padding: "24px 16px", textAlign: "center" }}>
                              <div style={{ display: "flex", justifyContent: "center", gap: 6, marginBottom: 10 }}>
                                {[0,1,2].map(d => <div key={d} style={{ width: 8, height: 8, borderRadius: "50%", background: C.blue, animation: `pulse 1.2s ease ${d*.2}s infinite` }} />)}
                              </div>
                              <div style={{ fontSize: 13, color: C.muted }}>Identifying food items...</div>
                            </div>
                          </div>
                        )}

                        {/* Items identified — user inputs macros per item */}
                        {scanImage && !scanLoading && scanResults.length > 0 && (
                          <div>
                            <img src={scanImage} style={{ width: "100%", borderRadius: 12, marginBottom: 12, maxHeight: 160, objectFit: "cover" }} />
                            <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 10 }}>
                              {scanResults.filter(r => !r.error).length} items found — add macros for each
                            </div>

                            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 12 }}>
                              {scanResults.map((item, idx) => {
                                const updateItem = (patch) => setScanResults(p => p.map((r,i) => i===idx ? {...r,...patch} : r));

                                const estimateMacros = async (grams) => {
                                  if (!grams || isNaN(parseFloat(grams))) return;
                                  updateItem({ estimating: true });
                                  try {
                                    const resp = await fetch("https://api.anthropic.com/v1/messages", {
                                      method: "POST",
                                      headers: { "Content-Type": "application/json" },
                                      body: JSON.stringify({
                                        model: "claude-sonnet-4-20250514",
                                        max_tokens: 200,
                                        messages: [{ role: "user", content: `For ${grams}g of ${item.name}, give me the estimated macros. Respond ONLY with valid JSON, no markdown: {"cal":165,"protein":31,"carbs":0,"fat":3.6}` }]
                                      })
                                    });
                                    const data = await resp.json();
                                    const txt = data.content?.map(c => c.text||"").join("") || "{}";
                                    const result = JSON.parse(txt.replace(/```json|```/g,"").trim());
                                    if (result.cal !== undefined) {
                                      updateItem({ estimating: false, cal: String(result.cal), protein: String(result.protein), carbs: String(result.carbs), fat: String(result.fat) });
                                    } else {
                                      updateItem({ estimating: false });
                                    }
                                  } catch { updateItem({ estimating: false }); }
                                };

                                return (
                                  <div key={idx} style={{ background: C.card, border: `1px solid ${item.error ? C.red : item.confirmed ? C.accentBorder : C.border}`, borderRadius: 14, overflow: "hidden" }}>

                                    {/* Item header */}
                                    <div style={{ padding: "11px 13px", display: "flex", alignItems: "center", gap: 8 }}>
                                      <div style={{ width: 20, height: 20, borderRadius: "50%", background: item.confirmed ? C.accent : C.border,
                                        border: `2px solid ${item.confirmed ? C.accent : C.muted}`, flexShrink: 0, cursor: "pointer",
                                        display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: C.bg, fontWeight: 800 }}
                                        onClick={() => updateItem({ confirmed: !item.confirmed })}>
                                        {item.confirmed ? "✓" : ""}
                                      </div>
                                      <input value={item.name} onChange={e => updateItem({ name: e.target.value })}
                                        style={{ flex: 1, background: "transparent", border: "none", color: C.text, fontSize: 14, fontWeight: 700, padding: 0 }} />
                                    </div>

                                    {item.confirmed && !item.error && (
                                      <div style={{ padding: "0 13px 12px" }}>

                                        {/* Grams input row */}
                                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                                          <div style={{ position: "relative", flex: 1 }}>
                                            <input
                                              type="number"
                                              value={item.grams}
                                              onChange={e => updateItem({ grams: e.target.value })}
                                              onBlur={e => estimateMacros(e.target.value)}
                                              onKeyDown={e => e.key === "Enter" && estimateMacros(item.grams)}
                                              placeholder="Enter grams..."
                                              style={{ width: "100%", padding: "9px 40px 9px 12px", background: C.bg, border: `1.5px solid ${C.accentBorder}`, borderRadius: 9, color: C.text, fontSize: 13, fontWeight: 600 }}
                                            />
                                            <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", fontSize: 11, color: C.muted, fontWeight: 600 }}>g</span>
                                          </div>
                                          <button className="bact"
                                            disabled={!item.grams || item.estimating}
                                            onClick={() => estimateMacros(item.grams)}
                                            style={{ padding: "9px 14px", background: item.grams && !item.estimating ? C.accent : C.border, color: item.grams && !item.estimating ? C.bg : C.muted, borderRadius: 9, fontSize: 12, fontWeight: 700, flexShrink: 0, transition: "all .2s", minWidth: 64 }}>
                                            {item.estimating
                                              ? <span style={{ display: "flex", gap: 3, justifyContent: "center" }}>{[0,1,2].map(d => <span key={d} style={{ width: 5, height: 5, borderRadius: "50%", background: C.muted, display: "inline-block", animation: `pulse 1s ease ${d*.15}s infinite` }} />)}</span>
                                              : "Estimate"}
                                          </button>
                                        </div>

                                        {/* Macro fields — pre-filled by estimate, fully editable */}
                                        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 6 }}>
                                          {[
                                            { key: "cal", label: "Cal", col: C.accent },
                                            { key: "protein", label: "Pro(g)", col: C.blue },
                                            { key: "carbs", label: "Carb(g)", col: C.orange },
                                            { key: "fat", label: "Fat(g)", col: C.purple },
                                          ].map(f => (
                                            <div key={f.key} style={{ textAlign: "center" }}>
                                              <div style={{ fontSize: 9, color: f.col, fontWeight: 700, marginBottom: 3 }}>{f.label}</div>
                                              <input type="number" value={item[f.key]} onChange={e => updateItem({ [f.key]: e.target.value })}
                                                placeholder="—"
                                                style={{ width: "100%", padding: "7px 4px", background: item[f.key] ? `${f.col}12` : C.bg, border: `1px solid ${item[f.key] ? f.col+"40" : C.border}`, borderRadius: 7, color: f.col, fontSize: 12, fontWeight: 700, textAlign: "center", transition: "all .3s" }} />
                                            </div>
                                          ))}
                                        </div>
                                        {item.cal && <div style={{ fontSize: 9, color: C.muted, marginTop: 6, textAlign: "right" }}>✏️ Tap any field to edit</div>}

                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>

                            <div style={{ display: "flex", gap: 8 }}>
                              <button className="bact" onClick={() => { setScanImage(null); setScanResults([]); }}
                                style={{ flex: 1, padding: "11px", background: C.border, borderRadius: 11, color: C.muted, fontSize: 12, fontWeight: 600 }}>Retake</button>
                              <button className="bact" onClick={() => {
                                scanResults.filter(r => r.confirmed && !r.error && r.cal).forEach(item => {
                                  setFoodLog(p => [...p, { name: item.name, cal: parseFloat(item.cal)||0, protein: parseFloat(item.protein)||0, carbs: parseFloat(item.carbs)||0, fat: parseFloat(item.fat)||0 }]);
                                });
                                setScanImage(null); setScanResults([]); setShowFoodSearch(false);
                              }} style={{ flex: 2, padding: "11px", background: C.accent, color: C.bg, borderRadius: 11, fontSize: 13, fontWeight: 700 }}>
                                Add {scanResults.filter(r => r.confirmed && !r.error && r.cal).length} Item{scanResults.filter(r=>r.confirmed&&!r.error&&r.cal).length!==1?"s":""} to Log ✓
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* BARCODE TAB — commented out (requires real network hosting)
                       Re-enable by restoring scanBarcodeFromFile, lookupBarcode functions
                       and the barcodeFileRef / barcodeResult / barcodeLoading state vars */}
                  </div>
                )}

                {/* Today's log */}
                {foodLog.length > 0 && (
                  <div>
                    <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", marginBottom: 8 }}>Today's Log</div>
                    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 13, overflow: "hidden" }}>
                      {foodLog.map((f, i) => {
                        const isFav = favorites.some(fv => fv.name === f.name);
                        return (
                          <div key={i} style={{ padding: "11px 13px", borderBottom: i < foodLog.length - 1 ? `1px solid ${C.border}` : "none", display: "flex", alignItems: "center", gap: 8, animation: "fadeUp .2s ease" }}>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: 13, fontWeight: 500 }}>{f.name}{f.custom && <span style={{ fontSize: 9, color: C.accent, fontWeight: 700, marginLeft: 6, background: C.accentDim, padding: "1px 5px", borderRadius: 4 }}>CUSTOM</span>}</div>
                              <div style={{ fontSize: 10, color: C.muted, marginTop: 1 }}>{f.protein}g P · {f.carbs}g C · {f.fat}g F</div>
                            </div>
                            <span style={{ fontSize: 13, fontWeight: 700, color: C.accent }}>{f.cal}</span>
                            <button onClick={() => setFavorites(fvs => isFav ? fvs.filter(fv => fv.name !== f.name) : [...fvs, f])}
                              style={{ background: "none", fontSize: 16, color: isFav ? C.yellow : C.muted, padding: "0 1px" }}>
                              {isFav ? "★" : "☆"}
                            </button>
                            <button onClick={() => setFoodLog(p => p.filter((_, j) => j !== i))} style={{ background: "none", color: C.muted, fontSize: 17, lineHeight: 1 }}>×</button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* — Photos — */}
            {trackSub === "photos" && (
              <div style={{ padding: "16px 18px", animation: "fadeUp .25s ease" }}>
                {/* Hidden file input */}
                <input ref={fileRef} type="file" accept="image/*" capture="environment"
                  onChange={e => {
                    const file = e.target.files[0]; if (!file) return;
                    const r = new FileReader();
                    r.onload = ev => {
                      const src = ev.target.result;
                      if (pendingShot === "front") {
                        setDraftEntry({ date: todayStr, front: src, side: null });
                        setPendingShot(null);
                      } else if (pendingShot === "side") {
                        setDraftEntry(d => ({ ...d, side: src }));
                        setPendingShot(null);
                      }
                    };
                    r.readAsDataURL(file);
                  }} style={{ display: "none" }} />

                {/* Draft entry in-progress */}
                {draftEntry ? (
                  <div style={{ background: C.card, border: `1px solid ${C.accentBorder}`, borderRadius: 16, padding: 16, marginBottom: 18 }}>
                    <div style={{ fontSize: 12, color: C.accent, fontWeight: 700, marginBottom: 12, letterSpacing: 0.5 }}>
                      📅 {draftEntry.date} — In Progress
                    </div>
                    <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
                      {/* Front */}
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, marginBottom: 6, textAlign: "center" }}>Front</div>
                        {draftEntry.front
                          ? <div style={{ position: "relative" }}>
                              <img src={draftEntry.front} style={{ width: "100%", aspectRatio: "3/4", objectFit: "cover", borderRadius: 10, display: "block" }} />
                              <button onClick={() => setDraftEntry(d => ({ ...d, front: null }))}
                                style={{ position: "absolute", top: 5, right: 5, width: 22, height: 22, borderRadius: "50%", background: "#ff4d6dcc", color: "white", fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700 }}>×</button>
                            </div>
                          : <div onClick={() => { setPendingShot("front"); setTimeout(() => fileRef.current.click(), 50); }}
                              style={{ width: "100%", aspectRatio: "3/4", background: C.accentDim, border: `1.5px dashed ${C.accentBorder}`, borderRadius: 10, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", cursor: "pointer", gap: 6 }}>
                              <div style={{ fontSize: 24 }}>📷</div>
                              <div style={{ fontSize: 10, color: C.accent, fontWeight: 600 }}>Tap to capture</div>
                            </div>
                        }
                      </div>
                      {/* Side */}
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, marginBottom: 6, textAlign: "center" }}>Side</div>
                        {draftEntry.side
                          ? <div style={{ position: "relative" }}>
                              <img src={draftEntry.side} style={{ width: "100%", aspectRatio: "3/4", objectFit: "cover", borderRadius: 10, display: "block" }} />
                              <button onClick={() => setDraftEntry(d => ({ ...d, side: null }))}
                                style={{ position: "absolute", top: 5, right: 5, width: 22, height: 22, borderRadius: "50%", background: "#ff4d6dcc", color: "white", fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700 }}>×</button>
                            </div>
                          : <div onClick={() => { setPendingShot("side"); setTimeout(() => fileRef.current.click(), 50); }}
                              style={{ width: "100%", aspectRatio: "3/4", background: draftEntry.front ? C.accentDim : "#1c1c2e20", border: `1.5px dashed ${draftEntry.front ? C.accentBorder : C.border}`, borderRadius: 10, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", cursor: draftEntry.front ? "pointer" : "default", gap: 6, opacity: draftEntry.front ? 1 : 0.5 }}>
                              <div style={{ fontSize: 24 }}>📷</div>
                              <div style={{ fontSize: 10, color: draftEntry.front ? C.accent : C.muted, fontWeight: 600 }}>{draftEntry.front ? "Tap to capture" : "Front first"}</div>
                            </div>
                        }
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button className="bact" onClick={() => { setDraftEntry(null); setPendingShot(null); unlockBadge("photo_first"); }}
                        style={{ flex: 1, padding: "10px", background: "#ff4d6d15", color: C.red, borderRadius: 10, fontSize: 13, fontWeight: 600 }}>
                        Discard
                      </button>
                      <button className="bact"
                        disabled={!draftEntry.front}
                        onClick={() => {
                          setPhotos(p => [draftEntry, ...p]);
                          setDraftEntry(null);
                        }}
                        style={{ flex: 2, padding: "10px", background: draftEntry.front ? C.accent : C.border, color: draftEntry.front ? C.bg : C.muted, borderRadius: 10, fontSize: 13, fontWeight: 700, transition: "all .2s" }}>
                        Save Check-in ✓
                      </button>
                    </div>
                  </div>
                ) : (
                  <button className="bact" onClick={() => { setDraftEntry({ date: todayStr, front: null, side: null }); setPendingShot("front"); setTimeout(() => fileRef.current.click(), 50); }}
                    style={{ width: "100%", padding: 14, background: C.accent, color: C.bg, borderRadius: 13, fontSize: 14, fontWeight: 700, marginBottom: 18, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                    📸 New Progress Check-in
                  </button>
                )}

                {/* Before / After comparison */}
                {photos.length >= 2 && (() => {
                  const beforeIdx = beforePhotoIndex !== null && beforePhotoIndex < photos.length ? beforePhotoIndex : photos.length - 1;
                  const before = photos[beforeIdx];
                  const now    = photos[0]; // always newest
                  const getPhoto = (entry) => compareView === "front"
                    ? (entry.front || entry.side)
                    : (entry.side  || entry.front);
                  const hasSide = before.side || now.side;
                  return (
                    <div style={{ background: C.card, border: `1px solid ${C.accentBorder}`, borderRadius: 16, padding: 14, marginBottom: 16 }}>
                      {/* Header row */}
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                        <div style={{ fontSize: 11, color: C.accent, fontWeight: 700, letterSpacing: 1 }}>BEFORE vs NOW</div>
                        {/* Front / Side toggle */}
                        <div style={{ display: "flex", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 20, padding: 2, gap: 2 }}>
                          {["front", "side"].map(v => (
                            <button key={v} onClick={() => setCompareView(v)}
                              disabled={v === "side" && !hasSide}
                              style={{
                                padding: "4px 12px", borderRadius: 18, fontSize: 10, fontWeight: 700, border: "none",
                                background: compareView === v ? C.accent : "transparent",
                                color: compareView === v ? C.bg : (v === "side" && !hasSide ? C.border : C.muted),
                                transition: "all .2s", cursor: v === "side" && !hasSide ? "default" : "pointer"
                              }}>
                              {v.charAt(0).toUpperCase() + v.slice(1)}
                            </button>
                          ))}
                        </div>
                      </div>
                      {/* Photos */}
                      <div style={{ display: "flex", gap: 8, width: "100%" }}>
                        {[{ label: "Before", entry: before }, { label: "Now", entry: now }].map(({ label, entry }) => (
                          <div key={label} style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, textAlign: "center", marginBottom: 5 }}>{label} · {entry.date}</div>
                            {getPhoto(entry)
                              ? <img src={getPhoto(entry)} style={{ width: "100%", aspectRatio: "3/4", objectFit: "cover", borderRadius: 10, border: `1px solid ${C.border}`, display: "block" }} />
                              : <div style={{ width: "100%", aspectRatio: "3/4", background: C.bg, borderRadius: 10, border: `1px dashed ${C.border}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: C.muted }}>No {compareView} photo</div>
                            }
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}

                {/* Saved entries */}
                {photos.length === 0 && !draftEntry ? (
                  <div style={{ textAlign: "center", padding: "44px 20px", background: C.card, borderRadius: 16, border: `1px dashed ${C.border}` }}>
                    <div style={{ fontSize: 44, marginBottom: 12 }}>📷</div>
                    <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 7 }}>No check-ins yet</div>
                    <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.6 }}>Each check-in captures a front & side view so you can see your full transformation.</div>
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                    {photos.length > 0 && <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", marginBottom: 2 }}>Past Check-ins</div>}
                    {photos.map((entry, i) => (
                      <div key={i} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 15, overflow: "hidden", animation: "fadeUp .3s ease" }}>
                        <div style={{ padding: "12px 14px 10px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: `1px solid ${C.border}` }}>
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 700 }}>{entry.date}</div>
                            <div style={{ fontSize: 10, color: C.muted, marginTop: 1 }}>{i === 0 ? "Most recent" : `${photos.length - i - 1 > 0 ? `${photos.length - 1 - i} check-in${photos.length - 1 - i !== 1 ? "s" : ""} ago` : "Earlier"}`}</div>
                          </div>
                          <div style={{ display: "flex", gap: 6 }}>
                            <button className="bact" onClick={() => setBeforePhotoIndex(i === beforePhotoIndex ? null : i)}
                              style={{ padding: "5px 10px", borderRadius: 8, fontSize: 11, fontWeight: 700,
                                background: i === beforePhotoIndex ? C.accentDim : C.bg,
                                color: i === beforePhotoIndex ? C.accent : C.muted,
                                border: `1px solid ${i === beforePhotoIndex ? C.accent : C.border}` }}>
                              {i === beforePhotoIndex ? "✓ Before" : "Set Before"}
                            </button>
                            <button className="bact" onClick={() => { setPhotos(prev => prev.filter((_, j) => j !== i)); if (i === beforePhotoIndex) setBeforePhotoIndex(null); }}
                              style={{ padding: "5px 10px", background: "#ff4d6d15", color: C.red, borderRadius: 8, fontSize: 11, fontWeight: 600 }}>Delete</button>
                          </div>
                        </div>
                        <div style={{ display: "flex" }}>
                          <div style={{ flex: 1, borderRight: `1px solid ${C.border}` }}>
                            <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, textAlign: "center", padding: "6px 0 4px" }}>Front</div>
                            {entry.front
                              ? <img src={entry.front} style={{ width: "100%", aspectRatio: "3/4", objectFit: "cover", display: "block" }} />
                              : <div style={{ width: "100%", aspectRatio: "3/4", background: C.border, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, color: C.muted }}>—</div>
                            }
                          </div>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, textAlign: "center", padding: "6px 0 4px" }}>Side</div>
                            {entry.side
                              ? <img src={entry.side} style={{ width: "100%", aspectRatio: "3/4", objectFit: "cover", display: "block" }} />
                              : <div style={{ width: "100%", aspectRatio: "3/4", background: C.border, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, color: C.muted }}>—</div>
                            }
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* — Connect — */}
            {/* ── MEAL PLAN TAB ── */}
            {trackSub === "meals" && (
              <div style={{ padding: "16px 18px", animation: "fadeUp .25s ease" }}>
                {!isPro ? (
                  <div style={{ textAlign: "center", padding: "32px 0" }}>
                    <div style={{ fontSize: 48, marginBottom: 12 }}>🥗</div>
                    <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 18, fontWeight: 800, marginBottom: 8 }}>AI Meal Plans</div>
                    <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.7, marginBottom: 20 }}>Full week of meals with macros, built around your goals. Pro feature.</div>
                    <button className="bact" onClick={() => setShowUpgrade(true)}
                      style={{ padding: "13px 28px", background: "linear-gradient(135deg,#FF9F0A,#FF5C00)", color: "#000", borderRadius: 13, fontSize: 14, fontWeight: 800 }}>⚡ Upgrade to Pro</button>
                  </div>
                ) : mealPlan ? (
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                      <div>
                        <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 17, fontWeight: 800 }}>Weekly Meal Plan</div>
                        <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>{mealPrefs.diet && `${mealPrefs.diet} · `}{CALORIE_GOAL} kcal · {PROTEIN_GOAL}g P · {CARBS_GOAL}g C · {FAT_GOAL}g F</div>
                      </div>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button className="bact" onClick={() => setShowShoppingList(true)}
                          style={{ padding: "6px 10px", background: "#3d9bff18", border: "1px solid #3d9bff40", borderRadius: 9, fontSize: 11, color: C.blue, fontWeight: 700 }}>🛒 List</button>
                        <button className="bact" onClick={() => setMealPlan(null)}
                          style={{ padding: "6px 10px", background: C.border, borderRadius: 9, fontSize: 11, color: C.muted, fontWeight: 600 }}>Redo</button>
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 4, marginBottom: 14, overflowX: "auto", paddingBottom: 4 }}>
                      {["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map((d, i) => (
                        <button key={i} onClick={() => setMealDay(i)}
                          style={{ flexShrink: 0, padding: "6px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700,
                            background: mealDay === i ? C.accent : C.card, color: mealDay === i ? C.bg : C.muted,
                            border: `1.5px solid ${mealDay === i ? C.accent : C.border}`, transition: "all .15s" }}>{d}</button>
                      ))}
                    </div>
                    {mealPlan.week?.[mealDay] && (() => {
                      const day = mealPlan.week[mealDay];
                      return (
                        <div>
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 6, marginBottom: 14 }}>
                            {[{label:"Cal",val:day.totalCal,col:C.accent},{label:"Protein",val:day.protein+"g",col:C.blue},{label:"Carbs",val:day.carbs+"g",col:C.orange},{label:"Fat",val:day.fat+"g",col:C.purple}].map(m => (
                              <div key={m.label} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: "8px 4px", textAlign: "center" }}>
                                <div style={{ fontSize: 9, color: m.col, fontWeight: 700, marginBottom: 2 }}>{m.label}</div>
                                <div style={{ fontSize: 13, fontWeight: 800, color: m.col }}>{m.val}</div>
                              </div>
                            ))}
                          </div>
                          {day.meals.map((meal, i) => (
                            <div key={i} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 13, padding: 13, marginBottom: 10 }}>
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                                <div style={{ fontSize: 12, color: C.accent, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>{meal.name}</div>
                                <div style={{ display: "flex", gap: 6, fontSize: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
                                  <span style={{ color: C.accent, fontWeight: 700 }}>{meal.cal} cal</span>
                                  <span style={{ color: C.blue }}>P:{meal.protein}g</span>
                                  <span style={{ color: C.orange }}>C:{meal.carbs}g</span>
                                  <span style={{ color: C.purple }}>F:{meal.fat}g</span>
                                </div>
                              </div>
                              {/* Add whole meal button */}
                              {(() => {
                                const mealKey = `meal-all-${mealDay}-${i}`;
                                const allLogged = loggedMealItems.has(mealKey);
                                return (
                                  <button className="bact" onClick={() => {
                                    if (allLogged) return;
                                    const perFood = meal.foods.length;
                                    meal.foods.forEach((food, fi) => {
                                      setFoodLog(p => [...p, {
                                        name: food.item,
                                        cal: Math.round((meal.cal || 0) / perFood),
                                        protein: Math.round(((meal.protein || 0) / perFood) * 10) / 10,
                                        carbs: Math.round(((meal.carbs || 0) / perFood) * 10) / 10,
                                        fat: Math.round(((meal.fat || 0) / perFood) * 10) / 10,
                                        servingLabel: food.amount,
                                      }]);
                                      setLoggedMealItems(s => new Set([...s, `meal-item-${mealDay}-${i}-${fi}`]));
                                    });
                                    setLoggedMealItems(s => new Set([...s, mealKey]));
                                  }} style={{ width: "100%", padding: "6px", background: allLogged ? "FF5C0015" : C.accentDim, border: `1px solid ${allLogged ? C.accent : C.accentBorder}`, borderRadius: 8, color: C.accent, fontSize: 11, fontWeight: 700, marginBottom: 4, cursor: allLogged ? "default" : "pointer", transition: "all .2s" }}>
                                    {allLogged ? "✓ Meal Logged" : "+ Log Entire Meal"}
                                  </button>
                                );
                              })()}
                              {meal.foods.map((food, j) => (
                                <div key={j} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderTop: `1px solid ${C.border}` }}>
                                  <div style={{ fontSize: 12, flex: 1 }}>{food.item}</div>
                                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                    <div style={{ fontSize: 11, color: C.muted }}>{food.amount}</div>
                                    {(() => {
                                      const itemKey = `meal-item-${mealDay}-${i}-${j}`;
                                      const logged = loggedMealItems.has(itemKey);
                                      return (
                                        <button className="bact" onClick={() => {
                                          if (logged) return;
                                          const perFood = meal.foods.length;
                                          setFoodLog(p => [...p, {
                                            name: food.item,
                                            cal: Math.round((meal.cal || 0) / perFood),
                                            protein: Math.round(((meal.protein || 0) / perFood) * 10) / 10,
                                            carbs: Math.round(((meal.carbs || 0) / perFood) * 10) / 10,
                                            fat: Math.round(((meal.fat || 0) / perFood) * 10) / 10,
                                            servingLabel: food.amount,
                                          }]);
                                          setLoggedMealItems(s => new Set([...s, itemKey]));
                                        }} style={{ padding: "3px 8px", background: logged ? "FF5C0020" : C.accentDim, border: `1px solid ${C.accentBorder}`, borderRadius: 6, color: C.accent, fontSize: logged ? 13 : 11, fontWeight: 700, cursor: logged ? "default" : "pointer", flexShrink: 0, transition: "all .2s", minWidth: 28, textAlign: "center" }}>
                                          {logged ? "✓" : "+"}
                                        </button>
                                      );
                                    })()}
                                  </div>
                                </div>
                              ))}
                            </div>
                          ))}
                        </div>
                      );
                    })()}
                  </div>
                ) : (
                  <div>
                    <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 16, fontWeight: 800, marginBottom: 4 }}>🥗 Build Your Meal Plan</div>
                    <div style={{ fontSize: 12, color: C.muted, marginBottom: 18 }}>Tell us your preferences and we'll plan a full week of meals.</div>
                    <div style={{ marginBottom: 14 }}>
                      <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, marginBottom: 8, letterSpacing: 0.5 }}>DIET STYLE</div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {["Standard","Low Carb","Keto","No Sugar","High Protein","Bulking","Cutting","Vegan","Vegetarian"].map(d => (
                          <button key={d} onClick={() => setMealPrefs(p => ({...p, diet: p.diet === d ? "" : d}))}
                            style={{ padding: "7px 12px", borderRadius: 20, fontSize: 11, fontWeight: 600,
                              background: mealPrefs.diet === d ? C.accentDim : C.card, color: mealPrefs.diet === d ? C.accent : C.muted,
                              border: `1.5px solid ${mealPrefs.diet === d ? C.accent : C.border}`, transition: "all .15s" }}>{d}</button>
                        ))}
                      </div>
                    </div>
                    <div style={{ marginBottom: 14 }}>
                      <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, marginBottom: 8, letterSpacing: 0.5 }}>GOAL</div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {["Lose Fat","Build Muscle","Maintain","Improve Energy","Better Performance"].map(g => (
                          <button key={g} onClick={() => setMealPrefs(p => ({...p, goal: p.goal === g ? "" : g}))}
                            style={{ padding: "7px 12px", borderRadius: 20, fontSize: 11, fontWeight: 600,
                              background: mealPrefs.goal === g ? C.accentDim : C.card, color: mealPrefs.goal === g ? C.accent : C.muted,
                              border: `1.5px solid ${mealPrefs.goal === g ? C.accent : C.border}`, transition: "all .15s" }}>{g}</button>
                        ))}
                      </div>
                    </div>
                    <div style={{ marginBottom: 14 }}>
                      <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, marginBottom: 6, letterSpacing: 0.5 }}>ALLERGIES</div>
                      <input value={mealPrefs.allergies} onChange={e => setMealPrefs(p => ({...p, allergies: e.target.value}))}
                        placeholder="e.g. peanuts, shellfish, dairy..."
                        style={{ width: "100%", padding: "10px 13px", background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, color: C.text, fontSize: 13 }} />
                    </div>
                    <div style={{ marginBottom: 22 }}>
                      <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, marginBottom: 6, letterSpacing: 0.5 }}>FOODS TO AVOID</div>
                      <input value={mealPrefs.avoid} onChange={e => setMealPrefs(p => ({...p, avoid: e.target.value}))}
                        placeholder="e.g. broccoli, red meat, eggs..."
                        style={{ width: "100%", padding: "10px 13px", background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, color: C.text, fontSize: 13 }} />
                    </div>
                    {mealPlanLoading ? (
                      <div style={{ display: "flex", justifyContent: "center", gap: 8, padding: "20px 0" }}>
                        {[0,1,2].map(d => <div key={d} style={{ width: 10, height: 10, borderRadius: "50%", background: C.accent, animation: `pulse 1.2s ease ${d*.2}s infinite` }} />)}
                      </div>
                    ) : (
                      <button className="bact" onClick={async () => {
                        setMealPlanLoading(true);
                        try {
                          const allergiesStr = mealPrefs.allergies ? `Allergies: ${mealPrefs.allergies}.` : "";
                          const avoidStr = mealPrefs.avoid ? `Avoid these foods: ${mealPrefs.avoid}.` : "";
                          const dietStr = mealPrefs.diet ? `Diet style: ${mealPrefs.diet}.` : "";
                          const goalStr = mealPrefs.goal || (GOALS.find(g=>g.id===profile.goal)?.label || "general health");
                          const prompt = `Create a 7-day meal plan Monday through Sunday. Goal: ${goalStr}. Daily calories: ${CALORIE_GOAL} kcal. Daily macros: ${PROTEIN_GOAL}g protein, ${CARBS_GOAL}g carbs, ${FAT_GOAL}g fat. ${dietStr} ${allergiesStr} ${avoidStr}

CRITICAL: Reuse the same core ingredients across multiple days to minimize the shopping list. Use chicken breast 3-4 days, oats every breakfast, same nuts for snacks, etc. Target max 20 unique ingredients for the whole week.

Reply with ONLY raw JSON, no markdown. Use this structure for all 7 days:
{"week":[{"day":"Monday","totalCal":${CALORIE_GOAL},"protein":${PROTEIN_GOAL},"carbs":${CARBS_GOAL},"fat":${FAT_GOAL},"meals":[{"name":"Breakfast","cal":450,"protein":35,"carbs":45,"fat":12,"foods":[{"item":"Oats","amount":"1 cup"},{"item":"Banana","amount":"1"}]},{"name":"Lunch","cal":600,"protein":45,"carbs":60,"fat":18,"foods":[{"item":"Chicken Breast","amount":"6oz"},{"item":"Brown Rice","amount":"1 cup"}]},{"name":"Snack","cal":200,"protein":15,"carbs":20,"fat":8,"foods":[{"item":"Almonds","amount":"1oz"}]},{"name":"Dinner","cal":650,"protein":45,"carbs":55,"fat":22,"foods":[{"item":"Salmon","amount":"5oz"},{"item":"Sweet Potato","amount":"1"}]},{"name":"Post-Workout","cal":100,"protein":10,"carbs":20,"fat":2,"foods":[{"item":"Protein Shake","amount":"1 scoop"}]}]}]}`;
                          const resp = await fetch("https://api.anthropic.com/v1/messages", {
                            method: "POST", headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 8000,
                              messages: [{ role: "user", content: prompt }]
                            })
                          });
                          const data = await resp.json();
                          if (data.error) throw new Error(data.error.message);
                          const txt = (data.content || []).map(c => c.text || "").join("");
                          const match = txt.match(/\{[\s\S]*\}/);
                          if (!match) throw new Error("No JSON in response");
                          const plan = JSON.parse(match[0]);
                          if (!plan.week || !Array.isArray(plan.week) || plan.week.length === 0) throw new Error("Plan missing week data");
                          setMealPlan(plan); setMealDay(0); unlockBadge("meal_plan");
                        } catch(e) { alert("Generation failed: " + e.message); }
                        setMealPlanLoading(false);

                        setMealPlanLoading(false);
                      }} style={{ width: "100%", padding: "14px", background: C.accent, color: C.bg, borderRadius: 13, fontSize: 14, fontWeight: 800 }}>
                        ✨ Generate Weekly Meal Plan
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* ── AWARDS TAB ── */}
            {trackSub === "awards" && (
              <div style={{ padding: "16px 18px", animation: "fadeUp .25s ease" }}>
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 16, fontWeight: 800, marginBottom: 4 }}>🏅 Achievements</div>
                  <div style={{ fontSize: 12, color: C.muted }}>{unlockedBadges.length} of {BADGES.length} unlocked</div>
                </div>
                {/* Progress bar */}
                <div style={{ background: C.border, borderRadius: 99, height: 6, marginBottom: 20, overflow: "hidden" }}>
                  <div style={{ width: `${(unlockedBadges.length / BADGES.length) * 100}%`, height: "100%", background: `linear-gradient(90deg, ${C.accent}, ${C.blue})`, borderRadius: 99, transition: "width .6s ease" }} />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  {BADGES.map(badge => {
                    const unlocked = unlockedBadges.includes(badge.id);
                    return (
                      <div key={badge.id} style={{ background: unlocked ? `${C.accentDim}` : C.card, border: `1px solid ${unlocked ? C.accentBorder : C.border}`, borderRadius: 14, padding: 14, textAlign: "center", opacity: unlocked ? 1 : 0.45, transition: "all .3s" }}>
                        <div style={{ fontSize: 32, marginBottom: 6, filter: unlocked ? "none" : "grayscale(1)" }}>{badge.icon}</div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: unlocked ? C.text : C.muted, marginBottom: 3 }}>{badge.label}</div>
                        <div style={{ fontSize: 10, color: C.muted, lineHeight: 1.4 }}>{badge.desc}</div>
                        {unlocked && <div style={{ fontSize: 9, color: C.accent, fontWeight: 700, marginTop: 6 }}>✓ UNLOCKED</div>}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

                        {trackSub === "connect" && (
              <div style={{ padding: "16px 18px", animation: "fadeUp .25s ease" }}>
                <div style={{ background: `linear-gradient(135deg,${C.accentDim},#3d9bff10)`, border: `1px solid ${C.accentBorder}`, borderRadius: 13, padding: 14, marginBottom: 18 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: C.accent, marginBottom: 5 }}>📱 Mobile Sync Note</div>
                  <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.6 }}>Full sync with Apple Health, Fitbit & wearables activates when FitCoachAI is installed on your phone!</div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {CONNECTED_APPS.map(app => {
                    const isOn = connected[app.id];
                    const isLoading = connectingId === app.id;
                    return (
                      <div key={app.id} style={{ background: C.card, border: `1px solid ${isOn ? C.accentBorder : C.border}`, borderRadius: 13, padding: "13px 14px", display: "flex", alignItems: "center", gap: 12, transition: "border .3s" }}>
                        <div style={{ width: 40, height: 40, borderRadius: 10, background: `${app.color}18`, border: `1.5px solid ${app.color}35`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 19, flexShrink: 0 }}>{app.icon}</div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 600, fontSize: 13 }}>{app.name}</div>
                          <div style={{ fontSize: 10, color: C.muted, marginTop: 1 }}>{app.desc}</div>
                        </div>
                        <button className="bact" onClick={() => connectApp(app.id)}
                          style={{ flexShrink: 0, padding: "7px 12px", borderRadius: 9, fontSize: 11, fontWeight: 700, transition: "all .2s",
                            background: isOn ? C.accentDim : isLoading ? C.border : `${app.color}20`,
                            color: isOn ? C.accent : isLoading ? C.muted : app.color,
                            border: `1.5px solid ${isOn ? C.accent : isLoading ? C.border : app.color}45` }}>
                          {isLoading ? <span style={{ display: "inline-block", animation: "spin .8s linear infinite" }}>⟳</span> : isOn ? "✓ On" : "Connect"}
                        </button>
                      </div>
                    );
                  })}
                </div>
                <div style={{ marginTop: 16, padding: 12, background: C.card, border: `1px solid ${C.border}`, borderRadius: 11, textAlign: "center" }}>
                  <div style={{ fontSize: 12, color: C.muted }}>{Object.values(connected).filter(Boolean).length} of {CONNECTED_APPS.length} apps connected</div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ══ COACH ══ */}
        {tab === "coach" && (
          <div style={{ animation: "fadeUp .3s ease" }}>
            {/* Free tier message counter */}
            {!isPro && (
              <div style={{ padding: "6px 18px", background: dailyMsgCount >= FREE_MSG_LIMIT ? "#ff4d6d12" : C.accentDim, borderBottom: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontSize: 11, color: dailyMsgCount >= FREE_MSG_LIMIT ? C.red : C.muted }}>
                  {dailyMsgCount >= FREE_MSG_LIMIT ? "Daily message limit reached" : `${FREE_MSG_LIMIT - dailyMsgCount} messages left today`}
                </div>
                <button onClick={() => setShowUpgrade(true)} style={{ fontSize: 10, fontWeight: 700, color: C.orange, background: `${C.orange}18`, border: `1px solid ${C.orange}40`, borderRadius: 20, padding: "3px 10px" }}>
                  ⚡ Go Pro
                </button>
              </div>
            )}
            {/* Coach identity bar */}
            <div style={{ padding: "14px 18px 12px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ width: 44, height: 44, borderRadius: "50%", overflow: "hidden", border: `2px solid ${coach.bg}60` }}><CoachAvatar coachId={coach.id} size={44} bg={coach.bg} /></div>
              <div>
                <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 17, fontWeight: 800, color: coach.bg }}>{coach.name}</div>
                <div style={{ fontSize: 11, color: C.muted, marginTop: 1 }}>{coach.title}</div>
              </div>
              <div style={{ marginLeft: "auto", fontSize: 10, color: coach.bg, background: `${coach.bg}18`, padding: "4px 10px", borderRadius: 20, fontWeight: 700 }}>{coach.vibe}</div>
            </div>
            {/* Messages scroll area — bottom padding clears fixed input bar */}
            <div style={{ overflowY: "auto", padding: "14px", paddingBottom: 145, display: "flex", flexDirection: "column", gap: 11 }}>
              {messages.map((m, i) => (
                <div key={i} style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start", animation: "fadeUp .2s ease" }}>
                  {m.role === "ai" && (
                    <div style={{ width: 34, height: 34, borderRadius: "50%", overflow: "hidden", border: `1.5px solid ${coach.bg}`, marginRight: 7, flexShrink: 0, marginTop: 2 }}><CoachAvatar coachId={coach.id} size={34} bg={coach.bg} /></div>
                  )}
                  <div style={{ maxWidth: "78%", background: m.role === "user" ? C.accent : C.card, color: m.role === "user" ? C.bg : C.text,
                    padding: "10px 13px", borderRadius: m.role === "user" ? "15px 15px 3px 15px" : "15px 15px 15px 3px",
                    fontSize: 13, lineHeight: 1.55, border: m.role === "ai" ? `1px solid ${C.border}` : "none", fontWeight: m.role === "user" ? 500 : 400 }}>
                    {m.text}
                  </div>
                </div>
              ))}
              {typing && (
                <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                  <div style={{ width: 34, height: 34, borderRadius: "50%", overflow: "hidden", border: `1.5px solid ${coach.bg}` }}><CoachAvatar coachId={coach.id} size={34} bg={coach.bg} /></div>
                  <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: "15px 15px 15px 3px", padding: "11px 14px", display: "flex", gap: 4 }}>
                    {[0, 1, 2].map(d => <div key={d} style={{ width: 5, height: 5, borderRadius: "50%", background: C.accent, animation: `pulse 1.2s ease ${d * .2}s infinite` }} />)}
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Input bar fixed just above the bottom nav */}
            <div style={{
              position: "fixed", bottom: 88, left: "50%", transform: "translateX(-50%)",
              width: "100%", maxWidth: 430, background: C.bg,
              borderTop: `1px solid ${C.border}`, zIndex: 10,
            }}>
              <div style={{ padding: "6px 12px 4px", display: "flex", gap: 5, overflowX: "auto" }}>
                {["Meal plan 🥗", "Workout tips 💪", "Beat plateau 🔥", "Recovery 😴", "Build habits 📊"].map(s => (
                  <button key={s} onClick={() => setChatInput(s)}
                    style={{ flexShrink: 0, padding: "5px 10px", background: C.accentDim, border: `1px solid ${C.accentBorder}`, borderRadius: 18, color: C.accent, fontSize: 10, fontWeight: 600, whiteSpace: "nowrap" }}>
                    {s}
                  </button>
                ))}
              </div>
              <div style={{ padding: "6px 13px 12px", display: "flex", gap: 7, alignItems: "flex-end" }}>
                <textarea value={chatInput} onChange={e => setChatInput(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                  placeholder="Ask your AI coach..." rows={1}
                  style={{ flex: 1, padding: "10px 13px", background: C.card, border: `1px solid ${C.border}`, borderRadius: 13, color: C.text, fontSize: 13, resize: "none", lineHeight: 1.4 }} />
                <button className="bact" onClick={sendMessage}
                  style={{ width: 42, height: 42, borderRadius: "50%", background: C.accent, color: C.bg, fontSize: 17, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>↑</button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* BOTTOM NAV */}
      <div style={{ position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: 430, background: C.card, borderTop: `1px solid ${C.border}`, display: "flex", padding: "10px 8px 26px", gap: 4 }}>
        {TABS.map(t => {
          const active = tab === t.id;
          return (
            <button key={t.id} onClick={() => setTab(t.id)}
              style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3, background: active ? C.accentDim : "none", borderRadius: 14, padding: "7px 0", transition: "all .2s", border: active ? `1px solid ${C.accentBorder}` : "1px solid transparent" }}>
              {t.id === "coach"
                ? <div style={{ width: 24, height: 24, borderRadius: "50%", overflow: "hidden", opacity: active ? 1 : 0.4, transform: active ? "scale(1.1)" : "scale(1)", transition: "all .2s" }}>
                    <CoachAvatar coachId={coach.id} size={24} bg={coach.bg} />
                  </div>
                : <div style={{ fontSize: 18, filter: active ? "none" : "grayscale(100%) opacity(.35)", transform: active ? "scale(1.1)" : "scale(1)", transition: "all .2s" }}>{t.icon}</div>
              }
              <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: .5, textTransform: "uppercase", color: active ? C.accent : C.muted, transition: "color .2s" }}>{t.id === "coach" ? coach.name : t.label}</div>
            </button>
          );
        })}
      </div>

      {/* ── PROFILE EDIT MODAL ── */}
      {showProfile && editProfile && (
        <div style={{ position: "fixed", inset: 0, background: "#000000cc", zIndex: 1000, display: "flex", alignItems: "flex-end", justifyContent: "center" }}
          onClick={e => { if (e.target === e.currentTarget) setShowProfile(false); }}>
          <div style={{ background: C.card, borderRadius: "24px 24px 0 0", padding: "24px 20px 40px", width: "100%", maxWidth: 430, animation: "fadeUp .3s ease", border: `1px solid ${C.border}`, maxHeight: "90vh", overflowY: "auto" }}>

            {/* Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 18, fontWeight: 800 }}>Edit Profile</div>
              <button onClick={() => setShowProfile(false)} style={{ background: C.border, border: "none", color: C.muted, width: 28, height: 28, borderRadius: "50%", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
            </div>

            {/* Photo */}
            <input ref={profilePhotoRef} type="file" accept="image/*" capture="user" onChange={e => {
              const file = e.target.files[0]; if (!file) return;
              const r = new FileReader(); r.onload = ev => setEditProfile(p => ({...p, photo: ev.target.result})); r.readAsDataURL(file);
            }} style={{ display: "none" }} />
            <div style={{ display: "flex", justifyContent: "center", marginBottom: 20 }}>
              <div style={{ position: "relative", cursor: "pointer" }} onClick={() => profilePhotoRef.current.click()}>
                {editProfile.photo
                  ? <img src={editProfile.photo} style={{ width: 80, height: 80, borderRadius: "50%", objectFit: "cover", border: `3px solid ${C.accentBorder}` }} />
                  : <div style={{ width: 80, height: 80, borderRadius: "50%", background: C.accentDim, border: `3px solid ${C.accentBorder}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 32 }}>👤</div>
                }
                <div style={{ position: "absolute", bottom: 0, right: 0, width: 24, height: 24, background: C.accent, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12 }}>📷</div>
              </div>
            </div>

            {/* Fields */}
            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 20 }}>
              {[
                { key: "name", label: "NAME", placeholder: "Your name" },
                { key: "age", label: "AGE", placeholder: "28", type: "number" },
              ].map(f => (
                <div key={f.key}>
                  <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, marginBottom: 5, letterSpacing: 0.5 }}>{f.label}</div>
                  <input type={f.type || "text"} value={editProfile[f.key] || ""} onChange={e => setEditProfile(p => ({...p, [f.key]: e.target.value}))}
                    placeholder={f.placeholder}
                    style={{ width: "100%", padding: "11px 13px", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, color: C.text, fontSize: 14 }} />
                </div>
              ))}
              <div>
                <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, marginBottom: 8, letterSpacing: 0.5 }}>BIOLOGICAL SEX</div>
                <div style={{ display: "flex", gap: 8 }}>
                  {[{id:"male",label:"Male"},{id:"female",label:"Female"}].map(s => (
                    <button key={s.id} onClick={() => setEditProfile(p => ({...p, sex: s.id}))}
                      style={{ flex: 1, padding: "10px", borderRadius: 10, fontSize: 13, fontWeight: 700,
                        border: `1.5px solid ${editProfile.sex === s.id ? C.accent : C.border}`,
                        background: editProfile.sex === s.id ? C.accentDim : C.bg,
                        color: editProfile.sex === s.id ? C.accent : C.muted, transition: "all .15s", cursor: "pointer" }}>{s.label}</button>
                  ))}
                </div>
              </div>
                            <div>
                <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, marginBottom: 5, letterSpacing: 0.5 }}>HEIGHT</div>
                <div style={{ display: "flex", gap: 8 }}>
                  <div style={{ flex: 1, position: "relative" }}>
                    <input type="number" value={editProfile.heightFt || ""} onChange={e => setEditProfile(p => ({...p, heightFt: e.target.value}))}
                      placeholder="5" style={{ width: "100%", padding: "11px 30px 11px 13px", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, color: C.text, fontSize: 14 }} />
                    <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", fontSize: 11, color: C.muted }}>ft</span>
                  </div>
                  <div style={{ flex: 1, position: "relative" }}>
                    <input type="number" value={editProfile.heightIn || ""} onChange={e => setEditProfile(p => ({...p, heightIn: e.target.value}))}
                      placeholder="10" style={{ width: "100%", padding: "11px 30px 11px 13px", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, color: C.text, fontSize: 14 }} />
                    <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", fontSize: 11, color: C.muted }}>in</span>
                  </div>
                </div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, marginBottom: 5, letterSpacing: 0.5 }}>CURRENT WEIGHT (lbs)</div>
                <div style={{ position: "relative" }}>
                  <input type="number" value={editProfile.weight || ""} onChange={e => setEditProfile(p => ({...p, weight: e.target.value}))}
                    placeholder="185" style={{ width: "100%", padding: "11px 40px 11px 13px", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, color: C.text, fontSize: 14 }} />
                  <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", fontSize: 11, color: C.muted }}>lbs</span>
                </div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, marginBottom: 5, letterSpacing: 0.5 }}>GOAL WEIGHT (lbs)</div>
                <div style={{ position: "relative" }}>
                  <input type="number" value={goalWeight} onChange={e => setGoalWeight(e.target.value)}
                    placeholder="e.g. 165" style={{ width: "100%", padding: "11px 40px 11px 13px", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, color: C.text, fontSize: 14 }} />
                  <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", fontSize: 11, color: C.muted }}>lbs</span>
                </div>
                {goalWeight && profile.weight && (
                  <div style={{ fontSize: 11, color: parseFloat(profile.weight) > parseFloat(goalWeight) ? C.accent : C.orange, marginTop: 5, fontWeight: 600 }}>
                    {Math.abs(parseFloat(profile.weight) - parseFloat(goalWeight)).toFixed(1)} lbs to go
                  </div>
                )}
              </div>
              <div>
                <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, marginBottom: 5, letterSpacing: 0.5 }}>DAILY WATER GOAL (oz)</div>
                <div style={{ position: "relative" }}>
                  <input type="number" value={waterGoal} onChange={e => { const v = parseInt(e.target.value); if (v > 0) setWaterGoal(v); }}
                    placeholder="64" style={{ width: "100%", padding: "11px 40px 11px 13px", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, color: C.text, fontSize: 14 }} />
                  <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", fontSize: 11, color: C.muted }}>oz</span>
                </div>
                <div style={{ fontSize: 10, color: C.muted, marginTop: 4 }}>Recommended: 64 oz (8 cups) · Active people: 80–100 oz</div>
              </div>
              {/* Goal */}
              <div>
                <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, marginBottom: 8, letterSpacing: 0.5 }}>GOAL</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {GOALS.map(g => (
                    <button key={g.id} onClick={() => setEditProfile(p => ({...p, goal: g.id}))}
                      style={{ padding: "7px 12px", borderRadius: 20, fontSize: 12, fontWeight: 600,
                        background: editProfile.goal === g.id ? C.accentDim : C.bg,
                        border: `1.5px solid ${editProfile.goal === g.id ? C.accent : C.border}`,
                        color: editProfile.goal === g.id ? C.accent : C.muted, transition: "all .15s" }}>
                      {g.icon} {g.label}
                    </button>
                  ))}
                </div>
              </div>
              {/* Coach swap — Pro only */}
              <div>
                <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, marginBottom: 8, letterSpacing: 0.5 }}>
                  COACH {!isPro && <span style={{ color: C.orange, marginLeft: 4 }}>⚡ PRO</span>}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {COACHES.map(c => {
                    const isSelected = editProfile.coachId === c.id;
                    const locked = !isPro && !isSelected;
                    return (
                      <div key={c.id} onClick={() => { if (locked) { setShowProfile(false); setShowUpgrade(true); } else setEditProfile(p => ({...p, coachId: c.id})); }}
                        style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 13px", borderRadius: 12, cursor: "pointer",
                          background: isSelected ? `${c.bg}18` : C.bg, border: `1.5px solid ${isSelected ? c.bg : C.border}`,
                          opacity: locked ? 0.5 : 1, transition: "all .15s" }}>
                        <div style={{ width: 36, height: 36, borderRadius: "50%", overflow: "hidden", flexShrink: 0 }}><CoachAvatar coachId={c.id} size={36} /></div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 13, fontWeight: 700, color: isSelected ? c.bg : C.text }}>{c.name}</div>
                          <div style={{ fontSize: 10, color: C.muted }}>{c.title}</div>
                        </div>
                        {locked ? <div style={{ fontSize: 10, color: C.orange }}>🔒</div>
                          : isSelected ? <div style={{ fontSize: 12, color: c.bg }}>✓</div> : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Team button */}
            <button className="bact" onClick={() => { setShowProfile(false); setShowTeam(true); }}
              style={{ width: "100%", padding: "12px", background: "#3d9bff18", border: "1px solid #3d9bff40", borderRadius: 12, color: C.blue, fontSize: 13, fontWeight: 700, marginBottom: 10 }}>
              👥 {team ? `My Team: ${team.name}` : "Create or Join a Team"}
            </button>

            {/* Save */}
            <button className="bact" onClick={() => {
              onProfileChange(editProfile);
              const newW = parseFloat(editProfile.weight);
              const curW = parseFloat(profile.weight);
              if (newW && newW !== curW) {
                const todayStr = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" });
                setWeightLog(p => [...p.filter(w => w.date !== todayStr), { date: todayStr, weight: newW }]);
              }
              setShowProfile(false);
            }} style={{ width: "100%", padding: "14px", background: C.accent, color: "#fff", borderRadius: 12, fontSize: 14, fontWeight: 800, marginBottom: 10 }}>
              Save Changes
            </button>
            {onSignOut && (
              <button className="bact" onClick={() => { setShowProfile(false); onSignOut(); }}
                style={{ width: "100%", padding: "12px", background: "transparent", border: `1px solid ${C.border}`, color: C.muted, borderRadius: 12, fontSize: 13, fontWeight: 600 }}>
                Sign Out
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── TEAM MODAL ── */}
      {showTeam && (
        <div style={{ position: "fixed", inset: 0, background: "#000000cc", zIndex: 1000, display: "flex", alignItems: "flex-end", justifyContent: "center" }}
          onClick={e => { if (e.target === e.currentTarget) setShowTeam(false); }}>
          <div style={{ background: C.card, borderRadius: "24px 24px 0 0", padding: "24px 20px 40px", width: "100%", maxWidth: 430, animation: "fadeUp .3s ease", border: `1px solid ${C.border}`, maxHeight: "90vh", overflowY: "auto" }}>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 18, fontWeight: 800 }}>👥 Team</div>
              <button onClick={() => setShowTeam(false)} style={{ background: C.border, border: "none", color: C.muted, width: 28, height: 28, borderRadius: "50%", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
            </div>

            {team ? (
              <div>
                {/* Team header */}
                <div style={{ background: "#3d9bff12", border: "1px solid #3d9bff30", borderRadius: 14, padding: 16, marginBottom: 16, textAlign: "center" }}>
                  <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 20, fontWeight: 800, color: C.blue, marginBottom: 4 }}>{team.name}</div>
                  <div style={{ fontSize: 11, color: C.muted, marginBottom: 10 }}>Invite code</div>
                  <div style={{ fontFamily: "monospace", fontSize: 22, fontWeight: 800, letterSpacing: 4, color: C.text, background: C.bg, padding: "8px 20px", borderRadius: 10, display: "inline-block" }}>{team.code}</div>
                  <div style={{ fontSize: 10, color: C.muted, marginTop: 6 }}>Share this code with friends to join your team</div>
                </div>

                {/* My sharing settings */}
                <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 14, padding: 14, marginBottom: 16 }}>
                  <div style={{ fontSize: 11, color: C.accent, fontWeight: 700, marginBottom: 10, letterSpacing: 0.5 }}>WHAT I SHARE WITH MY TEAM</div>
                  {[
                    { key: "weight", label: "Current Weight", icon: "⚖️" },
                    { key: "workouts", label: "Weekly Workouts", icon: "🏋️" },
                    { key: "streak", label: "Habit Streak", icon: "🔥" },
                    { key: "calories", label: "Daily Calories", icon: "🔥" },
                  ].map(s => (
                    <div key={s.key} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderBottom: `1px solid ${C.border}` }}>
                      <div style={{ fontSize: 16 }}>{s.icon}</div>
                      <div style={{ flex: 1, fontSize: 13, fontWeight: 500 }}>{s.label}</div>
                      <div onClick={() => setShareSettings(p => ({...p, [s.key]: !p[s.key]}))}
                        style={{ width: 40, height: 22, borderRadius: 11, background: shareSettings[s.key] ? C.accent : C.border, cursor: "pointer", position: "relative", transition: "all .2s" }}>
                        <div style={{ position: "absolute", top: 2, left: shareSettings[s.key] ? 20 : 2, width: 18, height: 18, borderRadius: "50%", background: "#fff", transition: "all .2s" }} />
                      </div>
                    </div>
                  ))}
                </div>

                {/* Members */}
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 11, color: C.muted, fontWeight: 700, letterSpacing: 1, marginBottom: 10 }}>MEMBERS ({team.members.length + 1})</div>
                  {/* Me */}
                  <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 13px", background: C.accentDim, border: `1px solid ${C.accentBorder}`, borderRadius: 13, marginBottom: 8 }}>
                    {profile.photo
                      ? <img src={profile.photo} style={{ width: 38, height: 38, borderRadius: "50%", objectFit: "cover" }} />
                      : <div style={{ width: 38, height: 38, borderRadius: "50%", background: C.accentDim, border: `1px solid ${C.accentBorder}`, display: "flex", alignItems: "center", justifyContent: "center" }}>👤</div>}
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 700 }}>{profile.name} <span style={{ fontSize: 10, color: C.accent }}>· You</span></div>
                      <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>
                        {shareSettings.weight && `${profile.weight}lbs`}
                        {shareSettings.streak && habitStreak > 0 && ` · 🔥${habitStreak}d`}
                        {shareSettings.workouts && ` · ${weightLog.length} logs`}
                      </div>
                    </div>
                  </div>
                  {/* Teammates (demo) */}
                  {team.members.map((m, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 13px", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 13, marginBottom: 8 }}>
                      <div style={{ width: 38, height: 38, borderRadius: "50%", background: `${m.color}20`, border: `1px solid ${m.color}40`, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Bebas Neue',sans-serif", fontWeight: 800, color: m.color, fontSize: 15 }}>{m.name[0]}</div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 700 }}>{m.name}</div>
                        <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>
                          {m.weight && `${m.weight}lbs`}
                          {m.streak > 0 && ` · 🔥${m.streak}d`}
                          {m.workouts && ` · ${m.workouts} workouts`}
                        </div>
                      </div>
                      <div style={{ fontSize: 10, color: m.calories > 1800 ? C.accent : C.orange, fontWeight: 700 }}>{m.calories} cal</div>
                    </div>
                  ))}
                </div>

                <button className="bact" onClick={() => setTeam(null)}
                  style={{ width: "100%", padding: "11px", background: "#ff4d6d15", color: C.red, borderRadius: 11, fontSize: 13, fontWeight: 600 }}>
                  Leave Team
                </button>
              </div>
            ) : (
              <div>
                {/* Tabs */}
                <div style={{ display: "flex", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 11, padding: 4, gap: 3, marginBottom: 20 }}>
                  {[{ id: "create", label: "Create Team" }, { id: "join", label: "Join Team" }].map(t => (
                    <button key={t.id} onClick={() => setTeamTab(t.id)}
                      style={{ flex: 1, padding: "8px", borderRadius: 8, fontSize: 12, fontWeight: 700, background: teamTab === t.id ? C.blue : "transparent", color: teamTab === t.id ? "#fff" : C.muted, border: "none", transition: "all .2s" }}>
                      {t.label}
                    </button>
                  ))}
                </div>

                {teamTab === "create" && (
                  <div>
                    <div style={{ textAlign: "center", marginBottom: 20 }}>
                      <div style={{ fontSize: 44, marginBottom: 8 }}>🏆</div>
                      <div style={{ fontSize: 14, color: C.muted, lineHeight: 1.6 }}>Create a team and invite friends. Share your progress and hold each other accountable.</div>
                    </div>
                    <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, marginBottom: 6, letterSpacing: 0.5 }}>TEAM NAME</div>
                    <input value={teamInput} onChange={e => setTeamInput(e.target.value)} placeholder="e.g. Gym Bros, Monday Crew..."
                      style={{ width: "100%", padding: "12px 14px", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 11, color: C.text, fontSize: 14, marginBottom: 14 }} />
                    <button className="bact"
                      disabled={!teamInput.trim()}
                      onClick={() => {
                        const code = Math.random().toString(36).substring(2,8).toUpperCase();
                        setTeam({ name: teamInput.trim(), code, members: [] }); unlockBadge("team_joined");
                        setTeamInput("");
                      }}
                      style={{ width: "100%", padding: "14px", background: teamInput.trim() ? C.blue : C.border, color: teamInput.trim() ? "#fff" : C.muted, borderRadius: 12, fontSize: 14, fontWeight: 700, transition: "all .2s" }}>
                      Create Team
                    </button>
                  </div>
                )}

                {teamTab === "join" && (
                  <div>
                    <div style={{ textAlign: "center", marginBottom: 20 }}>
                      <div style={{ fontSize: 44, marginBottom: 8 }}>🔑</div>
                      <div style={{ fontSize: 14, color: C.muted, lineHeight: 1.6 }}>Enter the invite code from a friend to join their team.</div>
                    </div>
                    <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, marginBottom: 6, letterSpacing: 0.5 }}>INVITE CODE</div>
                    <input value={teamInput} onChange={e => setTeamInput(e.target.value.toUpperCase())} placeholder="e.g. X7K2MN"
                      maxLength={6}
                      style={{ width: "100%", padding: "12px 14px", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 11, color: C.text, fontSize: 20, fontWeight: 800, letterSpacing: 4, textAlign: "center", marginBottom: 14, fontFamily: "monospace" }} />
                    <button className="bact"
                      disabled={teamInput.length < 4}
                      onClick={() => {
                        // Demo: create a fake team with demo members
                        setTeam({
                          name: "The Squad",
                          code: teamInput,
                          members: [
                            { name: "Jordan", color: "#3d9bff", weight: 178, streak: 5, workouts: 3, calories: 2100 },
                            { name: "Taylor", color: "#a855f7", weight: 145, streak: 12, workouts: 4, calories: 1750 },
                          ]
                        });
                        setTeamInput("");
                      }}
                      style={{ width: "100%", padding: "14px", background: teamInput.length >= 4 ? C.blue : C.border, color: teamInput.length >= 4 ? "#fff" : C.muted, borderRadius: 12, fontSize: 14, fontWeight: 700, transition: "all .2s" }}>
                      Join Team
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── SHOPPING LIST MODAL ── */}
      {showShoppingList && mealPlan && (
        <div style={{ position: "fixed", inset: 0, background: "#000000cc", zIndex: 1000, display: "flex", alignItems: "flex-end", justifyContent: "center" }}
          onClick={e => { if (e.target === e.currentTarget) setShowShoppingList(false); }}>
          <div style={{ background: C.card, borderRadius: "24px 24px 0 0", padding: "24px 20px 40px", width: "100%", maxWidth: 430, animation: "fadeUp .3s ease", border: `1px solid ${C.border}`, maxHeight: "85vh", overflowY: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 18, fontWeight: 800 }}>🛒 Shopping List</div>
              <button onClick={() => setShowShoppingList(false)} style={{ background: C.border, border: "none", color: C.muted, width: 28, height: 28, borderRadius: "50%", fontSize: 14 }}>✕</button>
            </div>
            <div style={{ fontSize: 11, color: C.muted, marginBottom: 18 }}>All ingredients for your weekly meal plan</div>
            {(() => {
              // Build consolidated shopping list — count total uses per item
              const allItems = {};
              mealPlan.week?.forEach(day => {
                day.meals?.forEach(meal => {
                  meal.foods?.forEach(food => {
                    const key = food.item.toLowerCase().trim();
                    if (!allItems[key]) allItems[key] = { item: food.item, uses: 0, amount: food.amount };
                    allItems[key].uses++;
                  });
                });
              });
              const items = Object.values(allItems).sort((a,b) => b.uses - a.uses);
              const listText = "SHOPPING LIST\n\n" + items.map(i => `- ${i.item} x${i.uses} (${i.amount} per serving)`).join("\n");

              return (
                <div>
                  <div style={{ fontSize: 10, color: C.muted, marginBottom: 10 }}>{items.length} items · sorted by most used</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 20 }}>
                    {items.map((item, i) => (
                      <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 12px", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10 }}>
                        <div style={{ fontSize: 13, fontWeight: 500 }}>☐ {item.item}</div>
                        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                          <div style={{ fontSize: 10, color: C.muted }}>{item.amount}</div>
                          <div style={{ fontSize: 10, color: C.accent, fontWeight: 700, background: C.accentDim, padding: "2px 7px", borderRadius: 20 }}>×{item.uses}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                  <button className="bact" onClick={() => {
                    const el = document.createElement("textarea");
                    el.value = listText;
                    document.body.appendChild(el);
                    el.select();
                    document.execCommand("copy");
                    document.body.removeChild(el);
                    alert("Shopping list copied! Paste it into your Notes app.");
                  }} style={{ width: "100%", padding: "13px", background: C.accent, color: C.bg, borderRadius: 12, fontSize: 14, fontWeight: 700 }}>
                    📋 Copy to Clipboard
                  </button>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* ── SERVING PICKER MODAL ── */}
      {servingPicker && (() => {
        const { food, qty, unit } = servingPicker;
        const multiplier = (parseFloat(qty) || 1) * (UNIT_TO_G[unit] || 100) / 100;
        const scaled = {
          cal:     Math.round(food.cal     * multiplier),
          protein: Math.round(food.protein * multiplier * 10) / 10,
          carbs:   Math.round(food.carbs   * multiplier * 10) / 10,
          fat:     Math.round(food.fat     * multiplier * 10) / 10,
        };
        return (
          <div style={{ position: "fixed", inset: 0, background: "#000000cc", zIndex: 2000, display: "flex", alignItems: "flex-end", justifyContent: "center" }}
            onClick={e => { if (e.target === e.currentTarget) setServingPicker(null); }}>
            <div style={{ background: C.card, borderRadius: "24px 24px 0 0", padding: "24px 20px 40px", width: "100%", maxWidth: 430, animation: "fadeUp .3s ease", border: `1px solid ${C.border}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 17, fontWeight: 800 }}>{food.name}</div>
                <button onClick={() => setServingPicker(null)} style={{ background: C.border, border: "none", color: C.muted, width: 28, height: 28, borderRadius: "50%", fontSize: 14, cursor: "pointer" }}>✕</button>
              </div>
              <div style={{ fontSize: 11, color: C.muted, marginBottom: 20 }}>Choose your serving size</div>

              {/* Qty + Unit row */}
              <div style={{ display: "flex", gap: 10, marginBottom: 18 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, marginBottom: 6, letterSpacing: 0.5 }}>AMOUNT</div>
                  <input type="number" value={qty} min="0.1" step="0.1"
                    onChange={e => setServingPicker(p => ({ ...p, qty: e.target.value }))}
                    style={{ width: "100%", padding: "12px 13px", background: C.bg, border: `1px solid ${C.accent}`, borderRadius: 10, color: C.text, fontSize: 18, fontWeight: 700, textAlign: "center" }} />
                </div>
                <div style={{ flex: 1.4 }}>
                  <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, marginBottom: 6, letterSpacing: 0.5 }}>UNIT</div>
                  <select value={unit} onChange={e => setServingPicker(p => ({ ...p, unit: e.target.value }))}
                    style={{ width: "100%", padding: "12px 13px", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, color: C.text, fontSize: 14, fontWeight: 600 }}>
                    {SERVING_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
              </div>

              {/* Scaled macro preview */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 6, marginBottom: 20 }}>
                {[{label:"Cal",val:scaled.cal,col:C.accent},{label:"Protein",val:scaled.protein+"g",col:C.blue},{label:"Carbs",val:scaled.carbs+"g",col:C.orange},{label:"Fat",val:scaled.fat+"g",col:C.purple}].map(m => (
                  <div key={m.label} style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, padding: "8px 4px", textAlign: "center" }}>
                    <div style={{ fontSize: 9, color: m.col, fontWeight: 700, marginBottom: 2 }}>{m.label}</div>
                    <div style={{ fontSize: 14, fontWeight: 800, color: m.col }}>{m.val}</div>
                  </div>
                ))}
              </div>

              <button className="bact" onClick={() => {
                setFoodLog(p => [...p, { ...food, ...scaled, servingLabel: `${qty} ${unit}` }]);
                setServingPicker(null);
                setShowFoodSearch(false);
                setFoodSearch(""); setFavSearch("");
              }} style={{ width: "100%", padding: "14px", background: C.accent, color: C.bg, borderRadius: 13, fontSize: 14, fontWeight: 800 }}>
                Add to Log
              </button>
            </div>
          </div>
        );
      })()}

            {/* ── NOTIFICATION SETUP MODAL ── */}
      {showNotifSetup && (
        <div style={{ position: "fixed", inset: 0, background: "#000000cc", zIndex: 1000, display: "flex", alignItems: "flex-end", justifyContent: "center" }}
          onClick={e => { if (e.target === e.currentTarget) setShowNotifSetup(false); }}>
          <div style={{ background: C.card, borderRadius: "24px 24px 0 0", padding: "24px 20px 40px", width: "100%", maxWidth: 430, animation: "fadeUp .3s ease", border: `1px solid ${C.border}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 18, fontWeight: 800 }}>🔔 Notifications</div>
              <button onClick={() => setShowNotifSetup(false)} style={{ background: C.border, border: "none", color: C.muted, width: 28, height: 28, borderRadius: "50%", fontSize: 14, cursor: "pointer" }}>✕</button>
            </div>
            <div style={{ fontSize: 12, color: C.muted, marginBottom: 20 }}>Stay on track with timely reminders</div>

            {!notifPerms ? (
              <div style={{ textAlign: "center", padding: "16px 0 8px" }}>
                <div style={{ fontSize: 44, marginBottom: 12 }}>🔕</div>
                <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>Enable Notifications</div>
                <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.6, marginBottom: 20 }}>Allow FitCoach to send you reminders to log meals, drink water, and stay consistent.</div>
                <button className="bact" onClick={() => {
                  if (typeof Notification !== "undefined" && Notification.permission !== "denied") {
                    Notification.requestPermission().then(p => { if (p === "granted") setNotifPerms(true); });
                  } else {
                    setNotifPerms(true); // demo fallback
                  }
                }} style={{ width: "100%", padding: "14px", background: C.accent, color: C.bg, borderRadius: 13, fontSize: 14, fontWeight: 800 }}>
                  Allow Notifications
                </button>
              </div>
            ) : (
              <div>
                <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: 1, marginBottom: 10 }}>REMINDER TYPES</div>
                {[
                  { key: "meals", icon: "🍽️", label: "Meal reminders", desc: "Log breakfast, lunch & dinner" },
                  { key: "workout", icon: "🏋️", label: "Workout reminder", desc: "Daily nudge to train" },
                  { key: "water", icon: "💧", label: "Water reminders", desc: "Hourly hydration checks" },
                  { key: "checkin", icon: "📊", label: "Weekly check-in", desc: "Sunday progress review" },
                ].map(n => (
                  <div key={n.key} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0", borderBottom: `1px solid ${C.border}` }}>
                    <div style={{ fontSize: 22, width: 36, textAlign: "center" }}>{n.icon}</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 700 }}>{n.label}</div>
                      <div style={{ fontSize: 11, color: C.muted, marginTop: 1 }}>{n.desc}</div>
                    </div>
                    <div onClick={() => setNotifSettings(p => ({...p, [n.key]: !p[n.key]}))}
                      style={{ width: 44, height: 24, borderRadius: 99, background: notifSettings[n.key] ? C.accent : C.border, cursor: "pointer", position: "relative", transition: "all .25s", flexShrink: 0 }}>
                      <div style={{ position: "absolute", top: 3, left: notifSettings[n.key] ? 23 : 3, width: 18, height: 18, borderRadius: "50%", background: "#fff", transition: "all .25s" }} />
                    </div>
                  </div>
                ))}
                <div style={{ marginTop: 16, padding: "12px 14px", background: C.accentDim, border: `1px solid ${C.accentBorder}`, borderRadius: 12 }}>
                  <div style={{ fontSize: 12, color: C.accent, fontWeight: 700, marginBottom: 2 }}>✓ Notifications active</div>
                  <div style={{ fontSize: 11, color: C.muted }}>Toggle individual reminders above. Full scheduling requires native app.</div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

            {/* ── HABIT MANAGER MODAL ── */}
      {showHabitManager && (
        <div style={{ position: "fixed", inset: 0, background: "#000000cc", zIndex: 1000, display: "flex", alignItems: "flex-end", justifyContent: "center" }}
          onClick={e => { if (e.target === e.currentTarget) setShowHabitManager(false); }}>
          <div style={{ background: C.card, borderRadius: "24px 24px 0 0", padding: "24px 20px 40px", width: "100%", maxWidth: 430, animation: "fadeUp .3s ease", border: `1px solid ${C.border}`, maxHeight: "85vh", overflowY: "auto" }}>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 18, fontWeight: 800 }}>My Habits</div>
              <button onClick={() => setShowHabitManager(false)} style={{ background: C.border, border: "none", color: C.muted, width: 28, height: 28, borderRadius: "50%", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>✕</button>
            </div>
            <div style={{ fontSize: 11, color: C.muted, marginBottom: 18 }}>{isPro ? "Pro · unlimited habits" : "Free · 3 core + 1 custom"}</div>

            {/* Current habits */}
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
              {habits.map((h, i) => {
                const isCore = FREE_HABITS.some(f => f.id === h.id);
                const isCustom = h.id.startsWith("custom_");
                return (
                  <div key={h.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 13px", background: C.bg, border: `1px solid ${isCore ? C.accentBorder : C.border}`, borderRadius: 12 }}>
                    <div style={{ fontSize: 20 }}>{h.icon}</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{h.label}</div>
                      {isCore && <div style={{ fontSize: 9, color: C.accent, fontWeight: 700, marginTop: 1 }}>FREE CORE HABIT</div>}
                      {!isCore && !isCustom && <div style={{ fontSize: 9, color: C.orange, fontWeight: 700, marginTop: 1 }}>⚡ PRO HABIT</div>}
                    </div>
                    {(isCustom || isPro) && !isCore && (
                      <button onClick={() => setHabits(p => p.filter((_,j) => j !== i))}
                        style={{ background: "#ff4d6d15", color: C.red, border: "none", borderRadius: 8, padding: "4px 10px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>Remove</button>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Pro habits unlock */}
            {!isPro && (
              <div style={{ background: "#f59e0b10", border: `1px solid ${C.orange}40`, borderRadius: 13, padding: 13, marginBottom: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.orange, marginBottom: 6 }}>⚡ Pro Habits</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
                  {PRO_HABITS.map(h => (
                    <div key={h.id} style={{ display: "flex", alignItems: "center", gap: 8, opacity: 0.6 }}>
                      <div style={{ fontSize: 16 }}>{h.icon}</div>
                      <div style={{ fontSize: 12, color: C.muted }}>{h.label}</div>
                      <div style={{ marginLeft: "auto", fontSize: 10, color: C.orange }}>🔒</div>
                    </div>
                  ))}
                </div>
                <button className="bact" onClick={() => { setShowHabitManager(false); setShowUpgrade(true); }}
                  style={{ width: "100%", padding: "10px", background: "linear-gradient(135deg,#FF9F0A,#FF5C00)", color: "#000", borderRadius: 10, fontSize: 12, fontWeight: 800 }}>
                  Unlock with Pro ⚡
                </button>
              </div>
            )}

            {/* Add custom habit */}
            {(() => {
              const customHabits = habits.filter(h => h.id.startsWith("custom_"));
              const canAddCustom = isPro || customHabits.length < 1;
              return (
                <div style={{ background: C.bg, border: `1px solid ${canAddCustom ? C.border : C.border}`, borderRadius: 14, padding: 14 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                    <div style={{ fontSize: 11, color: C.accent, fontWeight: 700, letterSpacing: 0.5 }}>ADD CUSTOM HABIT</div>
                    {!isPro && <div style={{ fontSize: 10, color: C.muted }}>{customHabits.length}/1 used</div>}
                  </div>
                  {!canAddCustom ? (
                    <div style={{ textAlign: "center", padding: "8px 0" }}>
                      <div style={{ fontSize: 12, color: C.muted, marginBottom: 10 }}>You've used your free custom habit slot. Upgrade to Pro for unlimited custom habits.</div>
                      <button className="bact" onClick={() => { setShowHabitManager(false); setShowUpgrade(true); }}
                        style={{ width: "100%", padding: "10px", background: "linear-gradient(135deg,#FF9F0A,#FF5C00)", color: "#000", borderRadius: 10, fontSize: 12, fontWeight: 800 }}>
                        ⚡ Go Pro for Unlimited
                      </button>
                    </div>
                  ) : (
                    <div>
                      <div style={{ fontSize: 10, color: C.muted, fontWeight: 600, marginBottom: 6 }}>PICK AN ICON</div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
                        {HABIT_ICONS.map(icon => (
                          <button key={icon} onClick={() => setNewHabitIcon(icon)}
                            style={{ width: 34, height: 34, borderRadius: 9, fontSize: 17, background: newHabitIcon === icon ? C.accentDim : C.card, border: `1.5px solid ${newHabitIcon === icon ? C.accent : C.border}`, transition: "all .15s", cursor: "pointer" }}>
                            {icon}
                          </button>
                        ))}
                      </div>
                      <div style={{ fontSize: 10, color: C.muted, fontWeight: 600, marginBottom: 6 }}>HABIT NAME</div>
                      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                        <div style={{ width: 36, height: 40, borderRadius: 9, background: C.accentDim, border: `1px solid ${C.accentBorder}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>{newHabitIcon}</div>
                        <input value={newHabitLabel} onChange={e => setNewHabitLabel(e.target.value)}
                          placeholder="e.g. No Alcohol, Meditate..."
                          style={{ flex: 1, padding: "10px 12px", background: C.card, border: `1px solid ${C.border}`, borderRadius: 9, color: C.text, fontSize: 13 }} />
                      </div>
                      <button className="bact" disabled={!newHabitLabel.trim()}
                        onClick={() => {
                          if (!newHabitLabel.trim()) return;
                          setHabits(p => [...p, { id: "custom_" + Date.now(), label: newHabitLabel.trim(), icon: newHabitIcon }]);
                          setNewHabitLabel(""); setNewHabitIcon("✅");
                        }}
                        style={{ width: "100%", padding: "11px", background: newHabitLabel.trim() ? C.accent : C.border, color: newHabitLabel.trim() ? C.bg : C.muted, borderRadius: 10, fontSize: 13, fontWeight: 700, transition: "all .2s" }}>
                        Add Habit
                      </button>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* ── UPGRADE MODAL ── */}
      {showUpgrade && (
        <div style={{ position: "fixed", inset: 0, background: "#000000cc", zIndex: 1000, display: "flex", alignItems: "flex-end", justifyContent: "center" }}
          onClick={e => { if (e.target === e.currentTarget) setShowUpgrade(false); }}>
          <div style={{ background: C.card, borderRadius: "24px 24px 0 0", padding: "20px 20px 32px", width: "100%", maxWidth: 430, animation: "fadeUp .3s ease", border: `1px solid ${C.border}`, maxHeight: "92vh", overflowY: "auto" }}>

            {/* Header */}
            <div style={{ textAlign: "center", marginBottom: 16 }}>
              <div style={{ fontSize: 28, marginBottom: 6 }}>⚡</div>
              <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 20, fontWeight: 800, background: "linear-gradient(135deg,#FF9F0A,#FF5C00)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", marginBottom: 6 }}>
                FitCoach Pro
              </div>
              <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.6 }}>
                Unlock everything and take your results to the next level.
              </div>
            </div>

            {/* Feature list */}
            <div style={{ display: "flex", flexDirection: "column", gap: 5, marginBottom: 14 }}>
                  {[
                    { icon: "💬", label: "Unlimited coach messages" },
                    { icon: "🔄", label: "Switch coaches anytime" },
                    { icon: "📸", label: "AI Meal Scanner" },
                    { icon: "🥗", label: "Weekly meal plans" },
                    { icon: "📋", label: "AI workout plans" },
                    { icon: "🧠", label: "Context-aware coaching" },
                    { icon: "📊", label: "Macro trend analytics" },
                    { icon: "✅", label: "Weekly AI check-ins" },
                  ].map((f, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 12px", background: C.bg, borderRadius: 9, border: `1px solid ${C.border}` }}>
                      <div style={{ fontSize: 15 }}>{f.icon}</div>
                      <div style={{ flex: 1, fontSize: 12, fontWeight: 600 }}>{f.label}</div>
                      <div style={{ fontSize: 12, color: C.orange }}>✓</div>
                    </div>
                  ))}
                </div>

            {/* Pricing */}
            <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
              <div style={{ flex: 1, background: C.bg, border: `1.5px solid ${C.border}`, borderRadius: 14, padding: "12px 8px", textAlign: "center" }}>
                <div style={{ fontSize: 10, color: C.muted, fontWeight: 600, marginBottom: 3 }}>MONTHLY</div>
                <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 20, fontWeight: 800, color: C.text }}>$9.99</div>
                <div style={{ fontSize: 9, color: C.muted }}>per month</div>
              </div>
              <div style={{ flex: 1, background: "linear-gradient(135deg,#f59e0b18,#f9731618)", border: "1.5px solid #f59e0b60", borderRadius: 14, padding: "12px 8px", textAlign: "center", position: "relative" }}>
                <div style={{ position: "absolute", top: -9, left: "50%", transform: "translateX(-50%)", background: "linear-gradient(135deg,#FF9F0A,#FF5C00)", color: "#000", fontSize: 8, fontWeight: 800, padding: "2px 8px", borderRadius: 20, whiteSpace: "nowrap" }}>BEST VALUE</div>
                <div style={{ fontSize: 10, color: C.orange, fontWeight: 600, marginBottom: 3 }}>YEARLY</div>
                <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 20, fontWeight: 800, color: C.orange }}>$49.99</div>
                <div style={{ fontSize: 9, color: C.muted }}>$4.17/mo · 58% off</div>
              </div>
            </div>

            {/* Lifetime / Founder tier */}
            <div style={{ background: "linear-gradient(135deg,#a855f718,#6366f118)", border: "1.5px solid #a855f750", borderRadius: 14, padding: "14px 14px 12px", marginBottom: 16, position: "relative", overflow: "hidden" }}>
              {/* Shimmer line */}
              <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: "linear-gradient(90deg,#a855f7,#6366f1,#a855f7)" }} />
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                    <div style={{ fontSize: 10, color: "#a855f7", fontWeight: 800, letterSpacing: 0.5 }}>👑 FOUNDER'S LIFETIME</div>
                    <div style={{ fontSize: 8, fontWeight: 800, color: "#fff", background: "#a855f7", padding: "2px 6px", borderRadius: 20 }}>LIMITED</div>
                  </div>
                  <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 22, fontWeight: 800, color: "#a855f7" }}>$179.99</div>
                  <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>Pay once · own it forever</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 10, color: "#a855f7", fontWeight: 700 }}>Saves $370</div>
                  <div style={{ fontSize: 9, color: C.muted, marginTop: 1 }}>vs 3 yrs monthly</div>
                </div>
              </div>
            </div>

            {/* CTA */}
            <button className="bact" onClick={() => { setIsPro(true); setShowUpgrade(false); unlockBadge("pro_member"); }}
              style={{ width: "100%", padding: "15px", background: "linear-gradient(135deg,#FF9F0A,#FF5C00)", color: "#000", borderRadius: 14, fontSize: 15, fontWeight: 800, marginBottom: 6 }}>
              Start Free 3-Day Trial ⚡
            </button>
            <div style={{ fontSize: 10, color: C.muted, textAlign: "center", marginBottom: 10 }}>Monthly plan · cancel anytime</div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <div style={{ flex: 1, height: 1, background: C.border }} />
              <div style={{ fontSize: 10, color: C.muted }}>or commit & save</div>
              <div style={{ flex: 1, height: 1, background: C.border }} />
            </div>
            <button className="bact" onClick={() => { setIsPro(true); setShowUpgrade(false); unlockBadge("pro_member"); }}
              style={{ width: "100%", padding: "13px", background: "linear-gradient(135deg,#f59e0b12,#f9731612)", border: `1px solid ${C.orange}50`, color: C.orange, borderRadius: 14, fontSize: 13, fontWeight: 800, marginBottom: 6 }}>
              Get Yearly — $49.99
            </button>
            <button className="bact" onClick={() => { setIsPro(true); setShowUpgrade(false); unlockBadge("pro_member"); }}
              style={{ width: "100%", padding: "13px", background: "linear-gradient(135deg,#a855f718,#6366f118)", border: "1px solid #a855f750", color: "#a855f7", borderRadius: 14, fontSize: 13, fontWeight: 800, marginBottom: 10 }}>
              👑 Get Founder's Lifetime — $179.99
            </button>
            <button onClick={() => setShowUpgrade(false)}
              style={{ width: "100%", padding: "10px", background: "none", color: C.muted, fontSize: 12, fontWeight: 600 }}>
              Maybe later
            </button>
          </div>
        </div>
      )}

    </div>
  );
}
