# Start here

For getting Marketing HQ running on a Mac when you have never used a terminal.
No prior knowledge assumed. About 15 minutes, most of it waiting.

---

## What these things actually are

**Terminal** is an app that comes with your Mac (Applications → Utilities →
Terminal). Instead of clicking buttons, you type an instruction and press Enter.
That's the whole idea. It looks intimidating and isn't.

**Node** is a program that runs JavaScript on your computer. Marketing HQ is
written in JavaScript, so your Mac needs Node to run it. You don't have to learn
anything about it — it just has to be installed.

**npm** comes with Node. It fetches the 123 libraries this app is built on, and
it runs the shortcut commands (`npm run dev` and friends).

**One thing worth knowing:** when you run this, the app is running *on your own
Mac*. It isn't on the internet, nobody else can see it, and it stops when you
close Terminal. Putting it online is a separate step (SETUP.md).

---

## Step 0 — check Node is really installed

Downloading the installer isn't the same as running it. Let's check.

Open Terminal, type this, press Enter:

```
node -v
```

**You should see** something like `v22.11.0`. Any number 20.9 or higher is fine.

**If you see `command not found: node`** — it isn't installed yet. Go to
[nodejs.org](https://nodejs.org), download the macOS installer (the button on the
left, marked LTS), open the downloaded `.pkg` file, and click through it. Then
**quit Terminal and open it again** — it only notices new programs on startup.
Run `node -v` once more.

Don't continue until `node -v` prints a version number.

---

## Step 1 — get the code onto your Mac

No terminal needed for this bit.

1. Go to **https://github.com/johansvabo/marketinghq**
2. Click the branch dropdown (it says `main`) and choose
   **`claude/marketing-hq-platform-fof4ri`**
3. Click the green **Code** button → **Download ZIP**
4. Find the ZIP in your Downloads and **double-click** it to unzip
5. Drag the unzipped folder somewhere you'll find it again — **Documents** is fine

You now have a folder called something like
`marketinghq-claude-marketing-hq-platform-fof4ri`.

---

## Step 2 — point Terminal at that folder

Terminal is always "in" some folder. You need it to be in *that* one.

Type this in Terminal — note the **space after `cd`**, and don't press Enter yet:

```
cd 
```

Now **drag the folder** from Finder and drop it onto the Terminal window. Terminal
fills in the path for you. Now press Enter.

**To check it worked**, type:

```
pwd
```

It should print the path to your folder, ending in `marketinghq-something`. If it
prints `/Users/yourname` instead, the `cd` didn't take — try the drag again.

> `cd` means "change directory". `pwd` means "print working directory". That's the
> last bit of jargon, promise.

---

## Step 3 — three commands

Run these **one at a time**. Type or paste one line, press Enter, wait for it to
finish, then do the next. Don't paste all three at once.

### 1. Fetch the libraries

```
npm install
```

Usually under a minute, longer on a slow connection. Lots of text scrolls past —
that's normal. You may see yellow `npm warn deprecated` lines; ignore them,
they're harmless.

**Done when** you see something like `added 123 packages in 27s` and your cursor
comes back.

### 2. Build the database and fill it with example data

```
npm run setup
```

Takes about 10 seconds.

**Done when** you see `Done. Run npm run dev and open http://localhost:3000`

### 3. Start it

```
npm run dev
```

**Done when** you see a few lines like this:

```
- Local:        http://localhost:3000
  Network:      http://192.168.1.4:3000

Ready in 1.2s
```

This one **doesn't finish** — it keeps running, and that's correct. The app is
live for as long as this stays open.

---

## Step 4 — look at it

Open Safari or Chrome and go to:

```
http://localhost:3000
```

You should see the Today screen with three example clients. Click around — it's
all fake data, so you can't break anything.

---

## Stopping and starting again

**To stop it:** click the Terminal window and press **Control-C** (the `control`
key, not command). The app stops. Closing Terminal also works.

**To start it again later:** open Terminal, `cd` to the folder again (the drag
trick), and run `npm run dev`. You only ever do `npm install` and `npm run setup`
once.

**A shortcut:** press the **up arrow** in Terminal to bring back commands you've
already run, instead of retyping them.

---

## When something goes wrong

| What you see | What it means | What to do |
|---|---|---|
| `command not found: node` | Node isn't installed, or Terminal hasn't noticed it | Install from nodejs.org, then quit and reopen Terminal |
| `command not found: npm` | Same thing — npm arrives with Node | As above |
| `no such file or directory: package.json` | Terminal is in the wrong folder | Redo Step 2, check with `pwd` |
| `EACCES` or `permission denied` | The folder is somewhere protected | Move it to Documents and redo Step 2 |
| `Port 3000 is in use` | It's already running in another Terminal window | Use the address it offers instead, or Control-C in the other window |
| The page won't load | The `npm run dev` window was closed or stopped | Start it again with `npm run dev` |
| A wall of red text | Usually one real problem near the top | Copy the **first** 10 lines and paste them to me |

**Any error at all: copy the text and send it to me.** Don't try to decode it.
Reading these is a skill you don't need and I already have.

---

## Two things that are safe to ignore

- **Yellow `warn` lines** during `npm install` — normal, every project has them.
- **The colourful gibberish** during `npm run dev` — that's just it reporting progress.

Red `error` lines are worth telling me about. Yellow `warn` lines are not.

---

## What happens to the demo data

Everything you see at first — Nordic Supply, Veloce, Hallberg Legal — is invented,
so you can judge the thing with something in it. When you're ready for real data:

```
rm -rf data
npm run db:push
```

That empties it completely. Then add your own clients in **Settings**.

`npm run seed` puts the demo data back if you want it again.

---

## Then what?

Running locally is for deciding whether this is worth having. It only works when
your Mac is on, and only on your Mac.

When you want it properly — on your phone, running its nightly job, there when you
open your laptop somewhere else — that's **SETUP.md**. It's more involved, and
worth doing only once you know you want it.
