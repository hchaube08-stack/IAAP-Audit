const gridButton = document.getElementById('grid-view');
const listButton = document.getElementById('list-view');
const projectsGrid = document.getElementById('projects-grid');

function setView(view) {
  const isGrid = view === 'grid';
  projectsGrid.classList.toggle('list-layout', !isGrid);
  gridButton.classList.toggle('is-active', isGrid);
  listButton.classList.toggle('is-active', !isGrid);
  gridButton.setAttribute('aria-pressed', String(isGrid));
  listButton.setAttribute('aria-pressed', String(!isGrid));

  try {
    localStorage.setItem('audit-project-view', view);
  } catch {
    // Ignore storage failures; UI still works.
  }
}

function updateMilestoneSummary(card) {
  const milestoneSelect = card.querySelector('.milestone-select');
  const iterationWrap = card.querySelector('.iteration-wrap');
  const iterationSelect = card.querySelector('.iteration-select');
  const selectionText = card.querySelector('.selection-text');

  const isRoundTwo = milestoneSelect.value === 'round-2';
  iterationWrap.hidden = !isRoundTwo;

  selectionText.textContent = isRoundTwo
    ? `Selected: Round 2 — ${iterationSelect.value}`
    : 'Selected: Round 1';
}

document.querySelectorAll('.milestone-select').forEach((select) => {
  select.addEventListener('change', () => updateMilestoneSummary(select.closest('.audit-card')));
});

document.querySelectorAll('.iteration-select').forEach((select) => {
  select.addEventListener('change', () => updateMilestoneSummary(select.closest('.audit-card')));
});

gridButton.addEventListener('click', () => setView('grid'));
listButton.addEventListener('click', () => setView('list'));

let initialView = 'grid';
try {
  initialView = localStorage.getItem('audit-project-view') === 'list' ? 'list' : 'grid';
} catch {
  // Default to grid view when browser storage is unavailable.
}

setView(initialView);
document.querySelectorAll('.audit-card').forEach(updateMilestoneSummary);
