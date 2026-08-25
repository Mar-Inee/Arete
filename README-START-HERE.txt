ARETE NOW — USE IT IMMEDIATELY

WHAT THIS IS
Arete Now is a local-first installable web app (PWA). It is the fastest way to start using Arete now on Web and on an iPhone Home Screen without waiting for App Store/TestFlight signing.

START ON WINDOWS
1. Extract the ZIP.
2. Double-click START-ARETE-WINDOWS.bat
3. Your browser opens Arete.
4. The black window also prints an iPhone URL such as:
      http://192.168.0.25:8765

IPHONE
1. Keep the PC and iPhone on the same Wi-Fi.
2. Keep the Arete server window open.
3. Open the printed iPhone URL in Safari.
4. Tap Share.
5. Tap Add to Home Screen.
6. Name it Arete and tap Add.

IMPORTANT LOCAL-BUILD LIMITATION
Until Arete is deployed to a permanent HTTPS URL or a signed iOS build, the iPhone local-network version needs the PC server reachable at that address.
Your iPhone and Web browser keep separate local databases in this immediate build.

BACKUP / MOVE DATA
Open Backup in Arete:
- Export backup -> creates an Arete JSON backup.
- Import backup -> restores that data on another browser/device.
This is the immediate cross-device fallback while the real cloud-sync backend is being connected.

FEATURES IN THIS BUILD
- Task complete/incomplete
- Subtasks complete/incomplete
- Clean minus (-) remove controls
- Due date and time
- Tags
- Task activity
- Progress overview: completion, subtasks, 7-day activity, active tags
- Notes folders + subnotes
- Custom trackers
- Pomodoro: 25/50/5/15
- Productivity tools
- Task/tracker Resource Vault
- Link / book / tutorial / article / video / file / note resources
- Device/Files/Drive-provider file picker when the browser/OS exposes it
- Handwritten page photos -> one PDF
- Arete philosophy section
- Floral/sprouting cream + sage + lavender aesthetic
- Local backup export/import

DATA
Task/tracker/note data: browser local storage.
Uploaded books/files: browser IndexedDB.
The architecture is local-first so a cloud sync provider can be connected later without redesigning the task model.


FINAL PROTOTYPE ADDITION — MONTHLY GROWTH + GROUNDING FLASHCARDS

Monthly overall growth:
- Compares the current month with the previous month using DAILY PACE, not raw totals.
- Uses three signals: task completions, focus minutes, and active days.
- Shows a transparent overall month-over-month direction plus the three underlying metrics.
- One extreme metric is capped so it cannot dominate the overall result.

Grounding flashcards:
- A Qur'an flashcard is always available, whether the day is strong, weak, flat, or empty.
- Strong-output days intentionally receive a consistency/moderation anchor to reduce burnout and boom-bust productivity.
- Tap the card to flip from verse → Arete reflection + supporting hadith reference.
- Use Previous/Next to review the full card set.
- The app labels its own productivity reflection as NOT TAFSIR.
- Qur'an references link to Quran.com.
- Supporting hadith references link to Sunnah.com.

Verified supporting hadith references used:
- Sahih al-Bukhari 6464 — Book 81, Hadith 53
- Sahih al-Bukhari 6465 — Book 81, Hadith 54
- Sahih al-Bukhari 6467 — Book 81, Hadith 56

The spiritual texts are not treated as points, rewards, punishments, or productivity guarantees.


FINAL INTERFACE CONSOLIDATION
- Smart Lists: Open, Today, Tomorrow, Next 7 Days, Overdue, Completed, Won't Do, All
- Custom Lists: create your own; Inbox is the only default
- Tag filters
- Task detail tabs: Details, Notes, Resources, Activity, More
- Task More actions: Pin, Start Focus, Duplicate, Won't Do/Restore, Share, Delete
- Optional Urgent + Important fields
- Eisenhower Matrix generated from those fields
- Countdown: days left / days since
- Focus Statistics: today's sessions/time, totals, 7-day trend
- Mobile primary navigation: Tasks, Focus, Overview, Matrix, More
- More groups utilities so the bottom bar stays clean
