(() => {
  'use strict';

  const projectCard = document.getElementById('project-card');
  const gridButton = document.getElementById('grid-view');
  const listButton = document.getElementById('list-view');
  const milestoneSelect = document.getElementById('milestone-select');
  const iterationField = document.getElementById('iteration-field');
  const iterationSelect = document.getElementById('iteration-select');
  const selectionSummary = document.getElementById('selection-summary');

  function setView(view) {
    const isGrid = view === 'grid';
    projectCard.classList.remove('grid-layout', 'list-layout');
    projectCard.classList.add(isGrid ? 'grid-layout' : 'list-layout');
    gridButton.classList.toggle('is-active', isGrid);
    listButton.classList.toggle('is-active', !isGrid);
    gridButton.setAttribute('aria-pressed', String(isGrid));
    listButton.setAttribute('aria-pressed', String(!isGrid));

    try {
      localStorage.setItem('saransh-project-view', view);
    } catch {
      // View switching still works when browser storage is unavailable.
    }
  }

  function updateMilestone() {
    const roundTwo = milestoneSelect.value === 'round-2';
    iterationField.hidden = !roundTwo;
    selectionSummary.textContent = roundTwo
      ? `Selected: Round 2 — ${iterationSelect.options[iterationSelect.selectedIndex].text}`
      : 'Selected: Round 1';
  }

  gridButton.addEventListener('click', () => setView('grid'));
  listButton.addEventListener('click', () => setView('list'));
  milestoneSelect.addEventListener('change', updateMilestone);
  iterationSelect.addEventListener('change', updateMilestone);

  let initialView = 'grid';
  try {
    initialView = localStorage.getItem('saransh-project-view') === 'list' ? 'list' : 'grid';
  } catch {
    // Default to grid view when browser storage is unavailable.
  }
  setView(initialView);
  updateMilestone();
})();
