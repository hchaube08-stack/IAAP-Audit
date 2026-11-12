const filterButtons = document.querySelectorAll('.filter-btn');
const taskCards = document.querySelectorAll('.task-card');
const dialog = document.getElementById('task-dialog');
const openDialogButton = document.getElementById('open-task-dialog');
const closeDialogButton = document.getElementById('close-task-dialog');
const cancelDialogButton = document.getElementById('cancel-task-dialog');
const taskForm = document.getElementById('task-form');

function applyFilter(filterValue) {
  let visibleCount = 0;

  taskCards.forEach((card) => {
    const matches = filterValue === 'all' || card.dataset.status === filterValue;
    card.hidden = !matches;
    if (matches) visibleCount += 1;
  });

  const liveRegion = document.getElementById('task-grid');
  liveRegion.setAttribute('aria-label', `${visibleCount} tasks visible`);
}

filterButtons.forEach((button) => {
  button.addEventListener('click', () => {
    filterButtons.forEach((btn) => {
      const active = btn === button;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', String(active));
    });

    applyFilter(button.dataset.filter);
  });
});

function openDialog() {
  if (typeof dialog.showModal === 'function') {
    dialog.showModal();
  } else {
    dialog.setAttribute('open', 'open');
  }
}

function closeDialog() {
  if (typeof dialog.close === 'function' && dialog.open) {
    dialog.close();
  } else {
    dialog.removeAttribute('open');
  }
}

openDialogButton.addEventListener('click', openDialog);
closeDialogButton.addEventListener('click', closeDialog);
cancelDialogButton.addEventListener('click', closeDialog);

taskForm.addEventListener('submit', (event) => {
  event.preventDefault();

  const formData = new FormData(taskForm);
  const title = formData.get('title')?.toString().trim();
  const owner = formData.get('owner')?.toString().trim();
  const status = formData.get('status')?.toString();

  if (!title || !owner || !status) {
    return;
  }

  const newCard = document.createElement('article');
  newCard.className = 'task-card';
  newCard.dataset.status = status;
  newCard.tabIndex = 0;
  newCard.setAttribute('aria-label', `Task: ${title}. Status: ${status}.`);

  const tagName = ({ 'in-review': 'In review', blocked: 'Blocked', done: 'Done' })[status] || 'In review';
  const taskId = `A11Y-${Math.floor(Math.random() * 900 + 100)}`;

  newCard.innerHTML = `
    <div class="task-meta">
      <span class="status-tag ${status === 'in-review' ? 'status-review' : status === 'blocked' ? 'status-blocked' : 'status-done'}">${tagName}</span>
      <span class="task-id">${taskId}</span>
    </div>
    <h3>${title}</h3>
    <p>New task created for project tracking and accessibility validation.</p>
    <ul>
      <li>Owner: ${owner}</li>
      <li>Due: ${formData.get('date') || 'TBD'}</li>
    </ul>
  `;

  const grid = document.getElementById('task-grid');
  grid.appendChild(newCard);
  applyFilter(document.querySelector('.filter-btn.is-active')?.dataset.filter || 'all');
  taskForm.reset();
  closeDialog();
});

applyFilter('all');
