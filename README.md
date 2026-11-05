# Minutes

Meeting intelligence app for assignment Option 3.

You upload a meeting transcript and Minutes gives you a summary, the decisions, the action items and a chat for asking questions about the meeting. Answers link back to the line in the transcript they came from, so you can check them.

This is a proof of concept. There are no user accounts, everyone shares one workspace, and the hosted demo is behind a basic auth login. Please don't upload anything sensitive.

The home page lists all uploaded meetings. You can search by title or participant, filter by status, sort by any column, page through results and delete a meeting.


## Features

Transcripts can be plain .txt files, Otter or Google Meet exports, Zoom/Teams .vtt files or .srt subtitles. If a file has no timestamps, the app estimates them and marks them as estimates.

After upload the meeting goes into a queue. While Claude works on it, the page shows which step it's on.

Each meeting has three tabs:

- Overview has the summary, confirmed decisions and open questions, each linked to the transcript.
- Transcript can be read four ways: the conversation with questions, decisions, risks and emotions tagged; one section per speaker with a short summary; a timeline; and the original file.
- Action items lists each task with its owner and deadline. The Calendar, Email, Jira and PR buttons are placeholders and don't send anything yet.

Next to the tabs there's a chat. If you ask about something that wasn't discussed, it says so instead of guessing. You can also talk to the meeting using the ElevenLabs voice agent, which uses the same transcript evidence.

It works with transcripts in any language, including meetings that mix English and Tamil. The summary is written in English and the chat replies in whatever language you ask in.

API keys for Anthropic and ElevenLabs are added in Settings. They're stored encrypted in the database, so they survive restarts.

New users get a short walkthrough of the app, and another one the first time they open a meeting.


## Screenshots

Meeting list => docs/screenshots/02-meeting-library.jpg  
Meeting overview and chat => docs/screenshots/03-meeting-overview.jpg  
Conversation => docs/screenshots/04-transcript-conversation.jpg  
By speaker => docs/screenshots/05-transcript-speakers.jpg  
Timeline => docs/screenshots/06-transcript-timeline.jpg  
Original file => docs/screenshots/07-transcript-original.jpg  
Action items => docs/screenshots/08-action-items.jpg  
First-visit walkthrough => docs/screenshots/01-welcome-tour.jpg  
Settings => docs/screenshots/11-settings.jpg  


## How it works

The backend is a single FastAPI app with one database. I didn't add a message broker, a vector database or an agent framework.

The database is Supabase Postgres, using SQLAlchemy and Alembic for migrations. Row Level Security is on so Supabase's public API can't read the tables. SQLite also works locally.

The queue is a background thread that checks the database every second and claims one queued meeting with a single atomic update. If the server stops halfway through, that meeting is marked failed and can be retried.

For chat, the app only searches the selected meeting, using BM25 keyword search. Short transcripts (under 14,000 characters) are sent to Claude whole. Claude's answers have to follow a fixed Pydantic schema, and if an answer cites part of the transcript it wasn't given, it's rejected.

The voice agent runs on ElevenLabs Agents over WebRTC. It gets evidence by asking the browser, which calls the app's API, so there's no need for a public webhook.

The frontend is React 19 with Vite and Tailwind.


## Running it locally

I run it on a Mac with Python 3.12, uv (the Python package manager) and Node 22. Once those are installed, copy the env file and start everything with the dev script:

cp .env.example .env  
./scripts/dev.sh start

The script installs the packages, sets up the database and starts the backend on port 8000 and the frontend on port 5173. Open http://localhost:5173 in the browser.

To get real summaries, open Settings at the bottom of the sidebar and add an Anthropic API key. Without a key the app still works, but it only shows matching excerpts from the transcript. The ElevenLabs key is only needed if you want to try the voice agent. If you don't have a transcript handy, there's a sample in the samples folder called Atlas beta launch.txt.

A few other commands I use:

./scripts/dev.sh status => check what's running  
./scripts/dev.sh logs backend => see the backend logs  
./scripts/dev.sh stop => stop everything  
make test => run the backend and frontend tests


## Hosting

The demo runs from my machine. ./scripts/prod.sh start builds the frontend, updates the database and starts the app, then puts it online through a free Cloudflare tunnel with a username and password on it. That way I didn't need to buy a domain or set up a server. When I change the code, ./scripts/prod.sh deploy updates it and the link stays the same. The full steps are in docs/operations.md.


## Decisions and trade-offs

I used a queue in the database with one worker thread instead of Celery or Redis. For a proof of concept that's enough, it survives restarts and there are no extra services to run.

I used BM25 instead of a vector database. A single meeting is small, and keyword search is good at exact names and terms without paying for embeddings. The downside is that a question worded very differently from the transcript can miss.

I called the Claude API directly instead of using LangChain. The prompts and schemas are plain Python, which makes them easier to read and debug.

The Jira, PR, Calendar and Email buttons don't do anything yet. I added them to show where workflow integrations would go.


## Known limitations

- No user accounts; everyone shares one workspace.
- On startup, any meeting still marked "processing" is set to failed. That's wrong if two servers share one database.
- A valid citation means the answer points at real transcript text, not that the answer is correct.
- The tunnel URL changes if the host machine restarts or goes offline.
