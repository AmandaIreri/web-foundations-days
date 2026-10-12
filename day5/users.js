const API_URL = "https://jsonplaceholder.typicode.com/users";

const loadBtn = document.querySelector("#load-users");
const filterInput = document.querySelector("#filter-input");
const statusText = document.querySelector("#status");
const usersList = document.querySelector("#users-list");

let users = [];

function createUserCard(user) {
  const li = document.createElement("li");
  li.classList.add("user");

  const name = document.createElement("h3");
  name.textContent = user.name;

  const email = document.createElement("p");
  email.textContent = `Email: ${user.email}`;

  const city = document.createElement("p");
  city.textContent = `City: ${user.address.city}`;

  const company = document.createElement("p");
  company.textContent = `Company: ${user.company.name}`;

  li.append(name, email, city, company);
  return li;
}

function renderUsers(list) {
  usersList.replaceChildren();

  if (list.length === 0) {
    const empty = document.createElement("li");
    empty.classList.add("empty");
    empty.textContent = "No users match your filter.";
    usersList.appendChild(empty);
    return;
  }

  for (const user of list) {
    usersList.appendChild(createUserCard(user));
  }
}

function applyFilter() {
  const term = filterInput.value.trim().toLowerCase();
  const matches = users.filter((user) => user.name.toLowerCase().includes(term));
  renderUsers(matches);
}

async function loadUsers() {
  statusText.textContent = "Loading users...";
  statusText.classList.remove("error");
  loadBtn.disabled = true;

  try {
    const response = await fetch(API_URL);

    if (!response.ok) {
      throw new Error(`Server responded with status ${response.status}`);
    }

    users = await response.json();
    applyFilter();
    statusText.textContent = `Loaded ${users.length} users.`;
  } catch (error) {
    statusText.textContent = "Could not load users. Please try again.";
    statusText.classList.add("error");
    console.error(error);
  } finally {
    loadBtn.disabled = false;
  }
}

loadBtn.addEventListener("click", loadUsers);

filterInput.addEventListener("input", () => {
  if (users.length > 0) {
    applyFilter();
  }
});