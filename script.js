const DB_NAME = 'project-hub-local';
const DB_VERSION = 1;
const projectList = document.getElementById('project-list');
const emptyProjectList = document.getElementById('empty-project-list');
const projectForm = document.getElementById('project-form');
const filesPanel = document.getElementById('files-panel');
const fileList = document.getElementById('file-list');
const emptyFiles = document.getElementById('empty-files');
const filePicker = document.getElementById('file-picker');
const notice = document.getElementById('notice');
const saveProjectButton = document.getElementById('save-project');
const resetProjectButton = document.getElementById('reset-project');
const deleteProjectButton = document.getElementById('delete-project');
const detailsTitle = document.getElementById('details-title');

let db;
let activeProjectId = null;

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains('projects')) {
        database.createObjectStore('projects', { keyPath: 'id' });
      }
      if (!database.objectStoreNames.contains('files')) {
        const files = database.createObjectStore('files', { keyPath: 'id' });
        files.createIndex('projectId', 'projectId', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function store(name, mode = 'readonly') {
  return db.transaction(name, mode).objectStore(name);
}

function getAllProjects() {
  return requestResult(store('projects').getAll());
}

function getProjectFiles(projectId) {
  return requestResult(store('files').index('projectId').getAll(projectId));
}

function showNotice(message) {
  notice.textContent = message;
  notice.hidden = false;
  window.clearTimeout(showNotice.timeout);
  showNotice.timeout = window.setTimeout(() => { notice.hidden = true; }, 5000);
}

function readableStatus(status) {
  return ({ planning: 'Planning', 'in-progress': 'In progress', 'on-hold': 'On hold', complete: 'Complete' })[status] || 'Planning';
}

async function renderProjects() {
  const projects = (await getAllProjects()).sort((a, b) => b.updatedAt - a.updatedAt);
  projectList.replaceChildren();
  emptyProjectList.hidden = projects.length > 0;
  projects.forEach((project) => {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'project-choice';
    button.setAttribute('aria-current', String(project.id === activeProjectId));
    const name = document.createElement('strong');
    name.textContent = project.name;
    const status = document.createElement('small');
    status.textContent = readableStatus(project.status);
    button.append(name, status);
    button.addEventListener('click', () => selectProject(project.id));
    item.append(button);
    projectList.append(item);
  });
}

function clearProjectForm() {
  activeProjectId = null;
  projectForm.reset();
  detailsTitle.textContent = 'New project';
  saveProjectButton.textContent = 'Create project';
  resetProjectButton.hidden = true;
  deleteProjectButton.hidden = true;
  filesPanel.hidden = true;
  fileList.replaceChildren();
}

async function selectProject(id) {
  const project = await requestResult(store('projects').get(id));
  if (!project) return;
  activeProjectId = id;
  projectForm.elements.name.value = project.name;
  projectForm.elements.owner.value = project.owner || '';
  projectForm.elements.status.value = project.status || 'planning';
  projectForm.elements.description.value = project.description || '';
  detailsTitle.textContent = 'Update project';
  saveProjectButton.textContent = 'Save changes';
  resetProjectButton.hidden = false;
  deleteProjectButton.hidden = false;
  filesPanel.hidden = false;
  await renderProjects();
  await renderFiles();
}

projectForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const values = new FormData(projectForm);
  const name = String(values.get('name') || '').trim();
  if (!name) return;
  const existing = activeProjectId ? await requestResult(store('projects').get(activeProjectId)) : null;
  const project = {
    id: activeProjectId || crypto.randomUUID(),
    name,
    owner: String(values.get('owner') || '').trim(),
    status: String(values.get('status') || 'planning'),
    description: String(values.get('description') || '').trim(),
    createdAt: existing?.createdAt || Date.now(),
    updatedAt: Date.now()
  };
  await requestResult(store('projects', 'readwrite').put(project));
  activeProjectId = project.id;
  await selectProject(project.id);
  showNotice(existing ? 'Project updated.' : 'Project created. Add files to keep them with this project.');
});

document.getElementById('new-project').addEventListener('click', () => {
  clearProjectForm();
  document.getElementById('details-title').focus?.();
  projectForm.elements.name.focus();
});
resetProjectButton.addEventListener('click', () => {
  if (activeProjectId) selectProject(activeProjectId);
  else clearProjectForm();
});

deleteProjectButton.addEventListener('click', async () => {
  if (!activeProjectId || !window.confirm('Delete this project and all its attached files from this browser?')) return;
  const transaction = db.transaction(['projects', 'files'], 'readwrite');
  transaction.objectStore('projects').delete(activeProjectId);
  const fileStore = transaction.objectStore('files');
  const request = fileStore.index('projectId').openCursor(IDBKeyRange.only(activeProjectId));
  request.onsuccess = () => {
    const cursor = request.result;
    if (cursor) { cursor.delete(); cursor.continue(); }
  };
  transaction.oncomplete = async () => {
    clearProjectForm();
    await renderProjects();
    showNotice('Project and its attached files were deleted from this browser.');
  };
  transaction.onerror = () => showNotice('Could not delete the project. Please try again.');
});

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function renderFiles() {
  if (!activeProjectId) return;
  const files = (await getProjectFiles(activeProjectId)).sort((a, b) => b.updatedAt - a.updatedAt);
  fileList.replaceChildren();
  emptyFiles.hidden = files.length > 0;
  files.forEach((file) => {
    const item = document.createElement('li');
    item.className = 'file-item';
    const info = document.createElement('div');
    info.className = 'file-info';
    const name = document.createElement('strong');
    name.textContent = file.name;
    const metadata = document.createElement('small');
    metadata.textContent = `${formatBytes(file.size)} · Updated ${new Date(file.updatedAt).toLocaleString()}`;
    info.append(name, metadata);

    const actions = document.createElement('div');
    actions.className = 'file-actions';
    const download = document.createElement('a');
    download.className = 'file-action';
    download.textContent = 'Download';
    download.href = URL.createObjectURL(file.blob);
    download.download = file.name;
    download.addEventListener('click', () => {
      window.setTimeout(() => URL.revokeObjectURL(download.href), 1000);
    }, { once: true });

    const replace = document.createElement('button');
    replace.type = 'button';
    replace.className = 'file-action';
    replace.textContent = 'Replace';
    replace.addEventListener('click', () => chooseReplacement(file));
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'file-action remove';
    remove.textContent = 'Remove';
    remove.addEventListener('click', async () => {
      await requestResult(store('files', 'readwrite').delete(file.id));
      await renderFiles();
      showNotice(`${file.name} removed.`);
    });
    actions.append(download, replace, remove);
    item.append(info, actions);
    fileList.append(item);
  });
}

filePicker.addEventListener('change', async () => {
  if (!activeProjectId) return;
  const selectedFiles = Array.from(filePicker.files || []);
  try {
    for (const file of selectedFiles) {
      const record = { id: crypto.randomUUID(), projectId: activeProjectId, name: file.name, type: file.type, size: file.size, blob: file, updatedAt: Date.now() };
      await requestResult(store('files', 'readwrite').put(record));
    }
    await renderFiles();
    if (selectedFiles.length) showNotice(`${selectedFiles.length} file${selectedFiles.length === 1 ? '' : 's'} added to this project.`);
  } catch (error) {
    console.error(error);
    showNotice('The files could not be saved. Your browser may be out of storage space.');
  } finally {
    filePicker.value = '';
  }
});

function chooseReplacement(existingFile) {
  const picker = document.createElement('input');
  picker.type = 'file';
  picker.addEventListener('change', async () => {
    const replacement = picker.files?.[0];
    if (!replacement) return;
    const updated = { ...existingFile, name: replacement.name, type: replacement.type, size: replacement.size, blob: replacement, updatedAt: Date.now() };
    try {
      await requestResult(store('files', 'readwrite').put(updated));
      await renderFiles();
      showNotice(`${replacement.name} replaced the previous file.`);
    } catch (error) {
      console.error(error);
      showNotice('The replacement file could not be saved. Your browser may be out of storage space.');
    }
  });
  picker.click();
}

(async function initialize() {
  if (!('indexedDB' in window) || !('crypto' in window) || !crypto.randomUUID) {
    showNotice('This browser does not support the storage features this app needs. Try a current version of Chrome, Firefox, Safari, or Edge.');
    return;
  }
  try {
    db = await openDatabase();
    await renderProjects();
  } catch (error) {
    console.error(error);
    showNotice('Could not open local project storage. Check browser privacy settings and try again.');
  }
})();
