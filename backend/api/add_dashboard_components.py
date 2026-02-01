from models import Dashboard, NumberofEventsComponent, TextBoxComponent

dash = Dashboard.objects.first()
NumberOfEventsComponent.objects.create(dashboard=dash, x=10, y=10, width=20, height=20, color="red")
TextBoxComponent.objects.create(dashboard=dash, x=50, y=50, width=30, height=10, text="Notes here")


dash2 = Dashboard.objects.first()

for comp in dash2.components.all():
    print(comp.id, comp.component_type, comp.x, comp.y)