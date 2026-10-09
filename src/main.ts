const root = document.getElementById('app');
if (!root) throw new Error('#app missing');

// Placeholder until the first playable ticket lands: the combat strip, loot
// and save arrive in their own tickets (docs/design.md §13).
const title = document.createElement('h1');
title.textContent = 'Office Immortal';
const tagline = document.createElement('p');
tagline.textContent = 'Cultivate at your desk. Ascend from Intern to Immortal.';
root.append(title, tagline);
