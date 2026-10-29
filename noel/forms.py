from django import forms
from django.contrib.auth.forms import AuthenticationForm, UserCreationForm

from .models import Draw, Household, Idea, Member, User


class StyledMixin:
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        for f in self.fields.values():
            w = f.widget
            if isinstance(w, (forms.CheckboxInput, forms.CheckboxSelectMultiple)):
                continue
            w.attrs.setdefault("class", "input")


class LoginForm(StyledMixin, AuthenticationForm):
    error_messages = {
        "invalid_login": "Prénom ou mot de passe incorrect.",
        "inactive": "Ce compte est désactivé.",
    }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["username"].label = "Prénom"
        self.fields["username"].widget.attrs.update({"autocomplete": "username", "autocapitalize": "words"})
        self.fields["password"].label = "Mot de passe"


class SignupForm(StyledMixin, UserCreationForm):
    claim = forms.ModelChoiceField(
        queryset=Member.objects.none(),
        required=False,
        label="Je suis déjà sur le site",
        empty_label="— Non, je suis nouveau —",
        help_text="Si quelqu'un a déjà créé votre profil, choisissez-le pour récupérer votre liste.",
    )

    class Meta:
        model = User
        fields = ("username",)
        labels = {"username": "Prénom"}
        help_texts = {"username": "C'est ce que vous taperez pour vous connecter."}

    def __init__(self, *args, family=None, **kwargs):
        super().__init__(*args, **kwargs)
        self.family = family
        self.fields["password1"].label = "Mot de passe"
        self.fields["password2"].label = "Confirmation"
        self.fields["password1"].help_text = "Au moins 6 caractères."
        self.fields["password2"].help_text = ""
        if family is not None:
            qs = family.members.filter(user__isnull=True)
            self.fields["claim"].queryset = qs
            if not qs.exists():
                del self.fields["claim"]
        else:
            del self.fields["claim"]

    def clean_username(self):
        username = self.cleaned_data["username"].strip()
        if User.objects.filter(username__iexact=username).exists():
            raise forms.ValidationError(
                "Ce prénom est déjà pris. Ajoutez une initiale (ex. « Pierre B. ») ou connectez-vous."
            )
        return username


class JoinForm(StyledMixin, forms.Form):
    code = forms.CharField(label="Code d'invitation", max_length=64)


class IdeaForm(StyledMixin, forms.ModelForm):
    url = forms.URLField(label="Lien", required=False, max_length=500, assume_scheme="https",
                         widget=forms.URLInput(attrs={"placeholder": "https://… (facultatif)"}))

    class Meta:
        model = Idea
        fields = ["title", "details", "url", "price", "favorite"]
        widgets = {
            "title": forms.TextInput(attrs={"placeholder": "Ex. Un bon livre de cuisine italienne", "autocomplete": "off"}),
            "details": forms.Textarea(attrs={"rows": 2, "placeholder": "Taille, couleur, référence… (facultatif)"}),
            "price": forms.TextInput(attrs={"placeholder": "≈ 30 € (facultatif)"}),
        }

    def clean_url(self):
        url = self.cleaned_data.get("url", "").strip()
        if url and not url.startswith(("http://", "https://")):
            url = "https://" + url
        return url


class AccountForm(StyledMixin, forms.Form):
    name = forms.CharField(label="Prénom affiché", max_length=60)
    email = forms.EmailField(label="E-mail (facultatif)", required=False)


class DrawForm(StyledMixin, forms.ModelForm):
    participants = forms.ModelMultipleChoiceField(
        queryset=Member.objects.none(), widget=forms.CheckboxSelectMultiple, label="Participants"
    )

    class Meta:
        model = Draw
        fields = ["title", "budget", "rounds", "participants"]
        widgets = {
            "title": forms.TextInput(attrs={"placeholder": "Ex. Amis secrets 2026"}),
            "budget": forms.TextInput(attrs={"placeholder": "Ex. 30 € (facultatif)"}),
            "rounds": forms.Select(choices=[(1, "1 ami secret"), (2, "2 amis secrets"), (3, "3 amis secrets")]),
        }
        labels = {"rounds": "Nombre d'amis secrets par personne"}
        help_texts = {"rounds": "Chacun offre à autant de personnes différentes, sans doublon d'une boucle à l'autre."}

    def __init__(self, *args, family=None, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["participants"].queryset = family.members.select_related("household").order_by("name")


class MemberForm(StyledMixin, forms.ModelForm):
    class Meta:
        model = Member
        fields = ["name", "household", "is_admin", "managers"]
        widgets = {"managers": forms.CheckboxSelectMultiple}

    def __init__(self, *args, family=None, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["household"].queryset = family.households.all()
        self.fields["household"].empty_label = "— Aucun foyer —"
        self.fields["managers"].queryset = User.objects.filter(memberships__family=family).order_by("username")
        self.fields["managers"].label_from_instance = lambda u: u.memberships.filter(family=family).first() or u.username
        self.fields["managers"].required = False


class NewProfileForm(StyledMixin, forms.Form):
    name = forms.CharField(label="Prénom", max_length=60)
    household = forms.ModelChoiceField(queryset=Household.objects.none(), required=False, label="Foyer",
                                       empty_label="— Aucun foyer —")

    def __init__(self, *args, family=None, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["household"].queryset = family.households.all()


class HouseholdForm(StyledMixin, forms.ModelForm):
    class Meta:
        model = Household
        fields = ["name"]
        labels = {"name": "Nouveau foyer"}
        widgets = {"name": forms.TextInput(attrs={"placeholder": "Ex. Isabelle & Frédéric"})}


class FamilyForm(StyledMixin, forms.Form):
    name = forms.CharField(label="Nom de la famille", max_length=80,
                           widget=forms.TextInput(attrs={"placeholder": "Ex. Famille Jean"}))
