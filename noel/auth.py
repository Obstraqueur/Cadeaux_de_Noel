from django.contrib.auth import get_user_model
from django.contrib.auth.backends import ModelBackend


class CaseInsensitiveModelBackend(ModelBackend):
    """Connexion avec le prénom sans se soucier des majuscules ("edmond" = "Edmond")."""

    def authenticate(self, request, username=None, password=None, **kwargs):
        User = get_user_model()
        if username is None:
            username = kwargs.get(User.USERNAME_FIELD)
        if not username or password is None:
            return None
        try:
            user = User.objects.get(username__iexact=username.strip())
        except User.DoesNotExist:
            User().set_password(password)  # temps constant
            return None
        except User.MultipleObjectsReturned:
            user = User.objects.filter(username=username.strip()).first()
            if user is None:
                return None
        if user.check_password(password) and self.user_can_authenticate(user):
            return user
        return None
