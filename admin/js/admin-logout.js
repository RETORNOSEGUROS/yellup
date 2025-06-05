function logout() {
  firebase.auth().signOut().then(() => {
    window.location.href = "/admin/login.html";
  });
}
