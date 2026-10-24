# Emmy & Caleb's Vegan Recipes

A simple recipe website that runs for free on GitHub Pages. You can edit it from any phone or computer browser, protected by a password.

## What's in this folder

| File / folder | What it is |
|---|---|
| `index.html` | Home page: every recipe, grouped by category, with a category menu and search |
| `recipe.html` | The page for one recipe (`recipe.html?id=crepes`) |
| `admin.html` | The password-protected editor (add, edit and delete recipes, upload photos, manage categories) |
| `data/data.js` | All recipe text and categories. The editor updates it for you. |
| `data/config.js` | The editor's GitHub connection. Filled in automatically during setup. |
| `images/` | Uploaded photos. The editor shrinks them to 1600px before uploading. |

The site comes with 33 recipes. Their ingredients and directions are starter versions, so edit them to match how you make them.

## Putting it on GitHub (one time)

1. **Create a GitHub account** at github.com if you don't have one.
2. **Open GitHub Desktop** → *File → Add Local Repository…* → choose this **Website Docs** folder.
   The folder is already a git repository, so it opens straight away.
3. Click **Publish repository**. **Untick "Keep this code private"**, because free GitHub Pages needs a public repository.
4. On github.com, open the repository → **Settings → Pages**.
   Under *Build and deployment*, set **Source: Deploy from a branch**, **Branch: main**, folder **/ (root)**, then **Save**.
5. After a minute or two the site is live at
   `https://YOUR-USERNAME.github.io/REPOSITORY-NAME/`

## Turning on online editing (one time)

The editor saves changes into your GitHub repository, so it needs a GitHub "access token":

1. On github.com go to your profile picture → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
2. Name it something like "Recipe editor" and pick an expiration. (A longer one means fewer re-setups. When it expires, you just repeat these steps.)
3. **Repository access → Only select repositories** → pick your recipe repository.
4. **Permissions → Repository permissions → Contents → Read and write**.
5. Click **Generate token** and copy it. It starts with `github_pat_`.
6. Open `https://YOUR-USERNAME.github.io/REPOSITORY-NAME/admin.html`. You'll see **Connect the editor to GitHub**. Your username and repository are usually filled in already. Paste the token, enter the password **shiitake** twice, and click **Connect**.

That's it. From now on, open `admin.html` (or tap **Edit recipes** at the bottom of any page) on any device, type the password, and edit.

## Using the editor

- **Add recipe**: fill in the name, category, times, ingredients (one per line) and directions (one per line).
  A line ending with `:` (like `For the sauce:`) becomes a small heading.
- **Photos**: "Choose photo" sets the main photo, which appears behind the name on the home page. On a phone you can take a photo or pick one from your library. "Add photos" adds extra pictures shown in a gallery on the recipe page.
- **Categories & site settings** (bottom of the editor's main screen): rename, reorder, add or remove categories, and change the site name and tagline.
- After you save, the live site updates in **about a minute** (GitHub has to rebuild it).

## Good to know

- If you edit files on your computer **and** online, click **Fetch / Pull** in GitHub Desktop before pushing, so you pick up the online edits first.
- The token is saved in the repository **encrypted with the password**. Because the repository is public, a short dictionary-word password could be guessed with enough effort. The worst case is that someone could edit the recipe site (the token can only touch this one repository). For more protection, pick a longer password in **Change password / token**.
- To preview locally, double-click `index.html`. Editing only works on the live site.
