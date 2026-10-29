from django.contrib.auth import views as auth_views
from django.urls import path, reverse_lazy

from . import views
from .forms import LoginForm, StyledMixin
from django.contrib.auth.forms import SetPasswordForm


class StyledSetPasswordForm(StyledMixin, SetPasswordForm):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["new_password1"].label = "Nouveau mot de passe"
        self.fields["new_password1"].help_text = "Au moins 6 caractères."
        self.fields["new_password2"].label = "Confirmation"


urlpatterns = [
    path("", views.home, name="home"),
    path("connexion/", auth_views.LoginView.as_view(authentication_form=LoginForm, redirect_authenticated_user=True),
         name="login"),
    path("deconnexion/", auth_views.LogoutView.as_view(), name="logout"),
    path("invitation/<str:code>/", views.signup, name="signup"),
    path("rejoindre/", views.join, name="join"),
    path("nouvelle-famille/", views.create_family, name="create_family"),
    path("compte/", views.account, name="account"),
    path(
        "reinitialiser/<uidb64>/<token>/",
        auth_views.PasswordResetConfirmView.as_view(
            form_class=StyledSetPasswordForm,
            template_name="registration/reset_confirm.html",
            success_url=reverse_lazy("login"),
            post_reset_login=False,
        ),
        name="password_reset_confirm",
    ),

    path("f/<slug:slug>/", views.family, name="family"),
    path("f/<slug:slug>/personne/<int:member_id>/", views.member, name="member"),
    path("f/<slug:slug>/personne/<int:member_id>/ajouter/", views.idea_add, name="idea_add"),
    path("f/<slug:slug>/idee/<int:idea_id>/modifier/", views.idea_edit, name="idea_edit"),
    path("f/<slug:slug>/idee/<int:idea_id>/supprimer/", views.idea_delete, name="idea_delete"),
    path("f/<slug:slug>/idee/<int:idea_id>/actualite/", views.idea_keep, name="idea_keep"),
    path("f/<slug:slug>/idee/<int:idea_id>/<str:action>/", views.reservation_action, name="reservation"),
    path("f/<slug:slug>/mes-reservations/", views.my_reservations, name="reservations"),
    path("f/<slug:slug>/amis-secrets/", views.draws, name="draws"),
    path("f/<slug:slug>/amis-secrets/<int:draw_id>/supprimer/", views.draw_delete, name="draw_delete"),
    path("f/<slug:slug>/gestion/", views.manage, name="manage"),
]
